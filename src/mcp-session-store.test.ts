import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSupportedSdkVersion,
  MCP_SDK_VERSION,
  propsFromPersistedSession,
  restorePersistedTransportState,
  TransportSessionStore,
  type PersistedTransportSession,
} from "../mcp-server/session-store";

const persistedSession: PersistedTransportSession = {
  session_id: "session-1",
  transport: "streamable_http",
  user_login: "octocat",
  user_email: "cat@example.com",
  user_name: "Octo Cat",
  mcp_secret: "secret",
  init_request: {
    method: "initialize",
    params: {
      capabilities: { roots: {} },
      clientInfo: { name: "test-client", version: "1" },
    },
  },
  expires_at: "2026-08-01T00:00:00Z",
  last_seen_at: "2026-07-31T00:00:00Z",
  created_at: "2026-07-31T00:00:00Z",
  updated_at: "2026-07-31T00:00:00Z",
};

afterEach(() => vi.restoreAllMocks());

describe("TransportSessionStore", () => {
  it("creates sessions through the protected backend API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(persistedSession), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const store = new TransportSessionStore("https://api.example.com", "api-token", 3600);

    await store.create({
      sessionId: "session-1",
      transport: "streamable_http",
      mcpSecret: "secret",
      initRequest: persistedSession.init_request,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.example.com/internal/mcp/sessions/");
    expect(new Headers(init?.headers).get("X-MCP-Session-Token")).toBe("api-token");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      session_id: "session-1",
      ttl_seconds: 3600,
    });
  });

  it("restores SDK session and client initialization state", () => {
    const wrappedTransport = { _webStandardTransport: { sessionId: undefined, _initialized: false } };
    const protocol = {};

    restorePersistedTransportState(wrappedTransport, protocol, persistedSession);

    expect(wrappedTransport._webStandardTransport).toMatchObject({
      sessionId: "session-1",
      _initialized: true,
    });
    expect(protocol).toMatchObject({
      _clientCapabilities: { roots: {} },
      _clientVersion: { name: "test-client", version: "1" },
    });
  });

  it("reconstructs MCP props from the persisted user reference", () => {
    expect(propsFromPersistedSession(persistedSession)).toEqual({
      login: "octocat",
      name: "Octo Cat",
      email: "cat@example.com",
      accessToken: "",
      mcpSecret: "secret",
    });
  });
});

describe("SDK version guard", () => {
  it("resolves the installed SDK version", () => {
    expect(MCP_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reports the installed version as supported", () => {
    expect(isSupportedSdkVersion(MCP_SDK_VERSION)).toBe(true);
  });

  it("accepts versions within the supported range", () => {
    expect(isSupportedSdkVersion("1.12.3")).toBe(true);
    expect(isSupportedSdkVersion("1.30.0")).toBe(true);
    expect(isSupportedSdkVersion("1.99.99")).toBe(true);
  });

  it("rejects versions below the minimum", () => {
    expect(isSupportedSdkVersion("1.12.2")).toBe(false);
    expect(isSupportedSdkVersion("1.0.0")).toBe(false);
    expect(isSupportedSdkVersion("0.9.0")).toBe(false);
  });

  it("rejects versions at or above the next major", () => {
    expect(isSupportedSdkVersion("2.0.0")).toBe(false);
    expect(isSupportedSdkVersion("3.0.0")).toBe(false);
  });

  it("rejects undefined or unparseable versions", () => {
    expect(isSupportedSdkVersion(undefined)).toBe(false);
    expect(isSupportedSdkVersion("not-a-version")).toBe(false);
  });
});
