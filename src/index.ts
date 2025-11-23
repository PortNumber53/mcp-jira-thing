import { createMcpOAuthProvider, MyMCP, extractMcpSecretFromRequest, handleMcpWithoutOAuth, type McpEnv } from "./mcp-worker";
import { handleFrontendFetch, type Env as FrontendEnv } from "../frontend/src/worker";

type Env = McpEnv & FrontendEnv;

const mcpOAuthProvider = createMcpOAuthProvider();

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

    return handleFrontendFetch(request, env, ctx);
  },
};
