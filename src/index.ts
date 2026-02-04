import { createMcpOAuthProvider, MyMCP, extractMcpSecretFromRequest, handleMcpWithoutOAuth, type McpEnv } from "./mcp-worker";
import { handleFrontendFetch, type Env as FrontendEnv } from "../frontend/src/worker";
import { Hono } from 'hono';

type Env = McpEnv & FrontendEnv;

const mcpOAuthProvider = createMcpOAuthProvider();
const app = new Hono();

app.get('/', (c) => c.text('OK'));

function isMcpRoute(pathname: string): boolean {
  return (
    pathname === "/authorize" ||
    pathname === "/register" ||
    pathname === "/token" ||
    pathname.startsWith("/sse") ||
    pathname.startsWith("/mcp")
  );
}

export { MyMCP };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/sse") || url.pathname.startsWith("/mcp")) {
      const hasBearer = request.headers.get("authorization")?.toLowerCase().startsWith("bearer ");
      const hasMcpSecret = !!extractMcpSecretFromRequest(request);
      if (!hasBearer && hasMcpSecret) {
        return handleMcpWithoutOAuth(request, env, ctx);
      }
    }

    if (isMcpRoute(url.pathname)) {
      return mcpOAuthProvider.fetch(request, env, ctx);
    }
    
    // Fallback to the Hono app for routes not handled by MCP or Frontend
    const response = await app.fetch(request, env, ctx);
    if (response.status !== 404) {
      return response;
    }

    return handleFrontendFetch(request, env, ctx);
  },
};
