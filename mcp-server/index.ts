import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { extractMcpSecretFromRequest } from "./auth.js";
import { createSessionContext, type SessionContext } from "./context.js";
import type { McpEnv, Props } from "./jira-env.js";

const PORT = parseInt(process.env.MCP_SERVER_PORT || "3001", 10);
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || "";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

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

type SessionEntry = {
  context: SessionContext;
  cleanup: () => Promise<void>;
};

const sseSessions = new Map<string, { transport: SSEServerTransport; entry: SessionEntry }>();
const httpSessions = new Map<string, { transport: StreamableHTTPServerTransport; entry: SessionEntry }>();

async function resolveProps(req: express.Request): Promise<Props | undefined> {
  const mcpSecret = extractMcpSecretFromRequest(req);
  if (!mcpSecret) return undefined;

  if (!BACKEND_BASE_URL) {
    throw new Error("BACKEND_BASE_URL must be configured to resolve MCP sessions");
  }

  const secretUrl = new URL("/api/mcp/secret", BACKEND_BASE_URL);
  const email = req.headers["x-mcp-user-email"] as string | undefined;
  if (email) {
    secretUrl.searchParams.set("email", email);
  }

  const resp = await fetch(secretUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Failed to resolve MCP user info: ${resp.status}`);
  }
  const data = (await resp.json()) as {
    mcp_secret?: string;
    user_email?: string;
    user_login?: string;
    user_name?: string;
  };

  return {
    login: data.user_login || data.user_email || "",
    name: data.user_name || "",
    email: data.user_email || "",
    accessToken: "",
    mcpSecret: mcpSecret,
  };
}

// --- SSE Transport (legacy /sse endpoint) ---

app.get("/sse", async (req, res) => {
  try {
    const props = await resolveProps(req);
    const { context, cleanup } = await createSessionContext(baseEnv, props);
    const transport = new SSEServerTransport("/sse/message", res as any);
    const sessionId = transport.sessionId;

    sseSessions.set(sessionId, { transport, entry: { context, cleanup } });

    transport.onclose = async () => {
      const entry = sseSessions.get(sessionId);
      if (entry) {
        await entry.entry.cleanup();
        sseSessions.delete(sessionId);
      }
    };

    await context.server.connect(transport);
    console.log(`[sse] Session ${sessionId} connected`);
  } catch (err: any) {
    console.error("[sse] Failed to establish session:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.post("/sse/message", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const entry = sseSessions.get(sessionId);
  if (!entry) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await entry.transport.handlePostMessage(req as any, res as any, req.body);
});

// --- Streamable HTTP Transport (/mcp endpoint) ---

app.post("/mcp", async (req, res) => {
  try {
    const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionIdHeader ? httpSessions.get(sessionIdHeader) : undefined;

    if (existing) {
      await existing.transport.handleRequest(req as any, res as any, req.body);
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

    const props = await resolveProps(req);
    const { context, cleanup } = await createSessionContext(baseEnv, props);

    let transport: StreamableHTTPServerTransport;
    const transportOptions: any = {
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        httpSessions.set(sessionId, { transport, entry: { context, cleanup } });
        console.log(`[mcp] Session ${sessionId} initialized`);
      },
    };
    transport = new StreamableHTTPServerTransport(transportOptions);

    transport.onclose = async () => {
      const sid = transport.sessionId;
      if (sid) {
        const entry = httpSessions.get(sid);
        if (entry) {
          await entry.entry.cleanup();
          httpSessions.delete(sid);
        }
      }
    };

    await context.server.connect(transport);
    await transport.handleRequest(req as any, res as any, req.body);
  } catch (err: any) {
    console.error("[mcp] POST error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: "Missing session ID" });
    return;
  }
  const entry = httpSessions.get(sessionId);
  if (!entry) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await entry.transport.handleRequest(req as any, res as any);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: "Missing session ID" });
    return;
  }
  const entry = httpSessions.get(sessionId);
  if (!entry) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await entry.transport.handleRequest(req as any, res as any);
  await entry.entry.cleanup();
  httpSessions.delete(sessionId);
  console.log(`[mcp] Session ${sessionId} deleted`);
});

// --- Health check ---

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    sseSessions: sseSessions.size,
    httpSessions: httpSessions.size,
    backendBaseUrl: BACKEND_BASE_URL || "(not configured)",
  });
});

// --- Graceful shutdown ---

async function shutdown() {
  console.log("[shutdown] Cleaning up sessions...");
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
  console.log(`[mcp-server] SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`[mcp-server] MCP endpoint: http://localhost:${PORT}/mcp`);
});
