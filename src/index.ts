import { proxyToMcpServer, type McpEnv } from "./mcp-worker";
import { handleFrontendFetch, type Env as FrontendEnv } from "../frontend/src/worker";
import { Hono } from 'hono';

type Env = McpEnv & FrontendEnv;

const app = new Hono();

app.get('/', (c) => c.text('OK'));

function isMcpRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/sse") ||
    pathname.startsWith("/mcp")
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle Chrome DevTools well-known endpoint
    if (url.pathname === "/.well-known/appspecific/com.chrome.devtools.json") {
      return new Response(null, { status: 404 });
    }

    // Fast 404 for OAuth discovery so mcp-remote skips the timeout
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource") ||
        url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
        url.pathname === "/.well-known/openid-configuration") {
      return new Response(null, { status: 404 });
  }

    // Proxy MCP routes to the Node.js MCP server
    if (isMcpRoute(url.pathname)) {
      return proxyToMcpServer(request, env);
    }

    // Fallback to the Hono app for routes not handled by MCP or Frontend
    const response = await app.fetch(request, env, ctx);
    if (response.status !== 404) {
      return response;
    }

    return handleFrontendFetch(request, env, ctx);
  },
};
