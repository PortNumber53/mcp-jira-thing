import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { extractMcpSecretFromRequest } from "./auth.js";
import { createSessionContext, type SessionContext } from "./context.js";
import type { McpEnv } from "./jira-env.js";
import {
  propsFromPersistedSession,
  restorePersistedTransportState,
  SessionNotFoundError,
  TransportSessionStore,
} from "./session-store.js";

const PORT = parseInt(process.env.MCP_SERVER_PORT || "3001", 10);
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || "";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const MCP_SESSION_API_TOKEN = process.env.MCP_SESSION_API_TOKEN || process.env.SESSION_SECRET || "";
const MCP_SESSION_TTL_SECONDS = parsePositiveInteger(process.env.MCP_SESSION_TTL_SECONDS, 24 * 60 * 60);

const baseEnv: McpEnv = {
  BACKEND_BASE_URL,
  LOG_LEVEL,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  INTEGRATION_SLACK_ENABLED: process.env.INTEGRATION_SLACK_ENABLED,
  INTEGRATION_GOOGLE_DOCS_ENABLED: process.env.INTEGRATION_GOOGLE_DOCS_ENABLED,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

const transportSessionStore = new TransportSessionStore(
  BACKEND_BASE_URL,
  MCP_SESSION_API_TOKEN,
  MCP_SESSION_TTL_SECONDS,
);

type SessionEntry = {
  context: SessionContext;
  cleanup: () => Promise<void>;
};

type HTTPSession = { transport: StreamableHTTPServerTransport; entry: SessionEntry };

const sseSessions = new Map<string, { transport: SSEServerTransport; entry: SessionEntry }>();
const httpSessions = new Map<string, HTTPSession>();
const pendingHTTPRestores = new Map<string, Promise<HTTPSession | undefined>>();

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function disposeEntry(entry: SessionEntry): Promise<void> {
  await entry.cleanup();
}

async function restoreHTTPSession(sessionId: string) {
  const cached = httpSessions.get(sessionId);
  if (cached) return cached;

  const pending = pendingHTTPRestores.get(sessionId);
  if (pending) return pending;

  const restore = restoreHTTPSessionFromStore(sessionId).finally(() => {
    pendingHTTPRestores.delete(sessionId);
  });
  pendingHTTPRestores.set(sessionId, restore);
  return restore;
}

async function restoreHTTPSessionFromStore(sessionId: string): Promise<HTTPSession | undefined> {
  const persisted = await transportSessionStore.get(sessionId);
  if (!persisted || persisted.transport !== "streamable_http") return undefined;

  const { context, cleanup } = await createSessionContext(baseEnv, propsFromPersistedSession(persisted));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => persisted.session_id,
  });
  await context.server.connect(transport);
  restorePersistedTransportState(transport, context.server.server, persisted);

  const restored = { transport, entry: { context, cleanup } };
  httpSessions.set(sessionId, restored);
  console.log(`[mcp] Session ${sessionId} restored from PostgreSQL`);
  return restored;
}

// --- SSE Transport (legacy /sse endpoint) ---

app.get("/sse", async (req, res) => {
  let persistedSessionId: string | undefined;
  try {
    const transport = new SSEServerTransport("/sse/message", res as any);
    const sessionId = transport.sessionId;
    persistedSessionId = sessionId;
    const persisted = await transportSessionStore.create({
      sessionId,
      transport: "sse",
      mcpSecret: extractMcpSecretFromRequest(req),
    });
    const { context, cleanup } = await createSessionContext(baseEnv, propsFromPersistedSession(persisted));

    sseSessions.set(sessionId, { transport, entry: { context, cleanup } });
    await context.server.connect(transport);
    context.server.server.onclose = () => {
      const entry = sseSessions.get(sessionId);
      if (entry) {
        sseSessions.delete(sessionId);
        void Promise.all([
          disposeEntry(entry.entry),
          transportSessionStore.delete(sessionId),
        ]).catch((err) => console.error(`[sse] Failed to clean session ${sessionId}:`, err));
      }
    };
    console.log(`[sse] Session ${sessionId} connected`);
  } catch (err: any) {
    console.error("[sse] Failed to establish session:", err.message);
    if (persistedSessionId) {
      await transportSessionStore.delete(persistedSessionId).catch(() => undefined);
      sseSessions.delete(persistedSessionId);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.post("/sse/message", async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    const entry = sseSessions.get(sessionId);
    if (!entry) {
      const persisted = sessionId ? await transportSessionStore.get(sessionId) : undefined;
      res.status(persisted ? 410 : 404).json({
        error: persisted
          ? "SSE connection was interrupted; reconnect to establish a new live stream"
          : "Session not found",
      });
      return;
    }
    await transportSessionStore.touch(sessionId);
    await entry.transport.handlePostMessage(req as any, res as any, req.body);
  } catch (err: any) {
    if (!res.headersSent) {
      const status = err instanceof SessionNotFoundError ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  }
});

// --- Streamable HTTP Transport (/mcp endpoint) ---

app.post("/mcp", async (req, res) => {
  let newlyPersistedSessionId: string | undefined;
  try {
    const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionIdHeader ? await restoreHTTPSession(sessionIdHeader) : undefined;

    if (existing) {
      await transportSessionStore.touch(sessionIdHeader!);
      await existing.transport.handleRequest(req as any, res as any, req.body);
      return;
    }
    if (sessionIdHeader) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const isInit = isInitializeRequest(req.body);
    if (!isInit) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Missing or invalid session ID for non-initialize request" },
        id: req.body?.id ?? null,
      });
      return;
    }

    const sessionId = randomUUID();
    newlyPersistedSessionId = sessionId;
    const persisted = await transportSessionStore.create({
      sessionId,
      transport: "streamable_http",
      mcpSecret: extractMcpSecretFromRequest(req),
      initRequest: req.body,
    });
    const { context, cleanup } = await createSessionContext(baseEnv, propsFromPersistedSession(persisted));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });

    await context.server.connect(transport);
    httpSessions.set(sessionId, { transport, entry: { context, cleanup } });
    await transport.handleRequest(req as any, res as any, req.body);
    console.log(`[mcp] Session ${sessionId} initialized and persisted`);
  } catch (err: any) {
    console.error("[mcp] POST error:", err.message);
    if (newlyPersistedSessionId) {
      const entry = httpSessions.get(newlyPersistedSessionId);
      if (entry) await disposeEntry(entry.entry).catch(() => undefined);
      httpSessions.delete(newlyPersistedSessionId);
      await transportSessionStore.delete(newlyPersistedSessionId).catch(() => undefined);
    }
    if (!res.headersSent) {
      const status = err instanceof SessionNotFoundError ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  }
});

app.get("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "Missing session ID" });
      return;
    }
    const entry = await restoreHTTPSession(sessionId);
    if (!entry) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await transportSessionStore.touch(sessionId);
    await entry.transport.handleRequest(req as any, res as any);
  } catch (err: any) {
    if (!res.headersSent) {
      const status = err instanceof SessionNotFoundError ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  }
});

app.delete("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "Missing session ID" });
      return;
    }
    const entry = await restoreHTTPSession(sessionId);
    if (!entry) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await entry.transport.handleRequest(req as any, res as any);
    await disposeEntry(entry.entry);
    await transportSessionStore.delete(sessionId);
    httpSessions.delete(sessionId);
    console.log(`[mcp] Session ${sessionId} deleted`);
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// --- Health check ---

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    localSseSessions: sseSessions.size,
    localHttpSessions: httpSessions.size,
    sessionStore: "postgresql-via-backend-api",
    backendBaseUrl: BACKEND_BASE_URL || "(not configured)",
  });
});

// --- Graceful shutdown ---

async function shutdown() {
  console.log("[shutdown] Releasing local session resources; PostgreSQL sessions remain available for restoration...");
  for (const [, entry] of sseSessions) {
    await entry.entry.cleanup();
  }
  for (const [, entry] of httpSessions) {
    await entry.entry.cleanup();
  }
  sseSessions.clear();
  httpSessions.clear();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

app.listen(PORT, () => {
  console.log(`[mcp-server] Listening on port ${PORT}`);
  console.log(`[mcp-server] Backend URL: ${BACKEND_BASE_URL || "(not configured)"}`);
  console.log(`[mcp-server] Transport sessions: PostgreSQL via backend API (TTL ${MCP_SESSION_TTL_SECONDS}s)`);
  console.log(`[mcp-server] SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`[mcp-server] MCP endpoint: http://localhost:${PORT}/mcp`);
});
