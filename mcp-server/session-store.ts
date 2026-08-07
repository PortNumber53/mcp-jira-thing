import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Props } from "./jira-env.js";

export type TransportKind = "sse" | "streamable_http";

export type PersistedTransportSession = {
  session_id: string;
  transport: TransportKind;
  user_login?: string;
  user_email?: string;
  user_name?: string;
  init_request: unknown;
  expires_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

type CreateTransportSession = {
  sessionId: string;
  transport: TransportKind;
  mcpSecret?: string;
  initRequest?: unknown;
};

export class TransportSessionStore {
  constructor(
    private readonly backendBaseUrl: string,
    private readonly apiToken: string,
    private readonly ttlSeconds: number,
  ) {
    if (!backendBaseUrl) {
      throw new Error("BACKEND_BASE_URL must be configured for MCP transport session persistence");
    }
    if (!apiToken) {
      throw new Error("MCP_SESSION_API_TOKEN or SESSION_SECRET must be configured for MCP transport session persistence");
    }
  }

  async create(input: CreateTransportSession): Promise<PersistedTransportSession> {
    return this.request<PersistedTransportSession>("/internal/mcp/sessions/", {
      method: "POST",
      body: JSON.stringify({
        session_id: input.sessionId,
        transport: input.transport,
        mcp_secret: input.mcpSecret,
        init_request: input.initRequest ?? {},
        ttl_seconds: this.ttlSeconds,
      }),
    });
  }

  async get(sessionId: string): Promise<PersistedTransportSession | undefined> {
    const response = await this.fetchSession(sessionId, { method: "GET" });
    if (response.status === 404) return undefined;
    return this.readJSON<PersistedTransportSession>(response);
  }

  async touch(sessionId: string): Promise<void> {
    const response = await this.fetchSession(sessionId, {
      method: "PATCH",
      body: JSON.stringify({ ttl_seconds: this.ttlSeconds }),
    });
    if (response.status === 404) {
      throw new SessionNotFoundError(sessionId);
    }
    await this.ensureOK(response);
  }

  async delete(sessionId: string): Promise<void> {
    const response = await this.fetchSession(sessionId, { method: "DELETE" });
    if (response.status === 404) return;
    await this.ensureOK(response);
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.backendBaseUrl), {
      ...init,
      headers: this.headers(init.headers),
      signal: AbortSignal.timeout(10_000),
    });
    return this.readJSON<T>(response);
  }

  private fetchSession(sessionId: string, init: RequestInit): Promise<Response> {
    const path = `/internal/mcp/sessions/${encodeURIComponent(sessionId)}`;
    return fetch(new URL(path, this.backendBaseUrl), {
      ...init,
      headers: this.headers(init.headers),
      signal: AbortSignal.timeout(10_000),
    });
  }

  private headers(input?: ConstructorParameters<typeof Headers>[0]): Headers {
    const headers = new Headers(input);
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("X-MCP-Session-Token", this.apiToken);
    return headers;
  }

  private async readJSON<T>(response: Response): Promise<T> {
    await this.ensureOK(response);
    return (await response.json()) as T;
  }

  private async ensureOK(response: Response): Promise<void> {
    if (response.ok) return;
    const body = await response.text();
    throw new Error(`MCP session API request failed: ${response.status} ${body || response.statusText}`);
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`MCP transport session ${sessionId} was not found or has expired`);
    this.name = "SessionNotFoundError";
  }
}

// The MCP SDK does not currently expose a public constructor for restoring an
// initialized transport. This compatibility shim supports both the original
// Node transport and the newer wrapper around the Web Standard transport.
//
// The shim pokes at private SDK internals (_webStandardTransport, _initialized,
// _clientCapabilities, _clientVersion) that are not part of the public API and
// may change between SDK releases. A version guard ensures we only touch those
// fields when the installed SDK version is within the tested range, avoiding
// crashes or silent state corruption on incompatible upgrades.
const MIN_SUPPORTED_SDK_VERSION = { major: 1, minor: 12, patch: 3 };
const MAX_SUPPORTED_SDK_MAJOR = 2;
const SUPPORTED_SDK_RANGE = ">=1.12.3 <2.0.0";

function resolveSdkVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const entryPath = require.resolve("@modelcontextprotocol/sdk/server");
    let dir = dirname(entryPath);
    for (let i = 0; i < 10; i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        if (pkg.name === "@modelcontextprotocol/sdk") return pkg.version as string;
      } catch {
        // not a readable package.json — keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // SDK not installed or resolvable — leave version undefined
  }
  return undefined;
}

function parseSemver(version: string): { major: number; minor: number; patch: number } | undefined {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function isSupportedSdkVersion(version: string | undefined): boolean {
  if (!version) return false;
  const parsed = parseSemver(version);
  if (!parsed) return false;
  if (parsed.major < MIN_SUPPORTED_SDK_VERSION.major) return false;
  if (parsed.major > MIN_SUPPORTED_SDK_VERSION.major) return parsed.major < MAX_SUPPORTED_SDK_MAJOR;
  if (parsed.minor < MIN_SUPPORTED_SDK_VERSION.minor) return false;
  if (parsed.minor > MIN_SUPPORTED_SDK_VERSION.minor) return true;
  return parsed.patch >= MIN_SUPPORTED_SDK_VERSION.patch;
}

export const MCP_SDK_VERSION = resolveSdkVersion();

export function restorePersistedTransportState(
  transport: unknown,
  protocol: unknown,
  session: PersistedTransportSession,
): void {
  if (!isSupportedSdkVersion(MCP_SDK_VERSION)) {
    console.warn(
      `[mcp] Skipping transport state restoration: @modelcontextprotocol/sdk version ` +
        `${MCP_SDK_VERSION ?? "(unknown)"} is outside the supported range ` +
        `(${SUPPORTED_SDK_RANGE}). Session ${session.session_id} may not be fully restored.`,
    );
    return;
  }

  const transportInternals = transport as {
    sessionId?: string;
    _initialized?: boolean;
    _webStandardTransport?: { sessionId?: string; _initialized?: boolean };
  };
  const restorableState = transportInternals._webStandardTransport ?? transportInternals;
  restorableState.sessionId = session.session_id;
  restorableState._initialized = true;

  const init = session.init_request as {
    params?: { capabilities?: unknown; clientInfo?: unknown };
  };
  const protocolInternals = protocol as {
    _clientCapabilities?: unknown;
    _clientVersion?: unknown;
  };
  protocolInternals._clientCapabilities = init?.params?.capabilities;
  protocolInternals._clientVersion = init?.params?.clientInfo;
}

export function propsFromPersistedSession(
  session: PersistedTransportSession,
  mcpSecret?: string,
): Props | undefined {
  if (!session.user_login && !session.user_email && !mcpSecret) return undefined;
  return {
    login: session.user_login || session.user_email || "",
    name: session.user_name || "",
    email: session.user_email || "",
    accessToken: "",
    mcpSecret,
  };
}
