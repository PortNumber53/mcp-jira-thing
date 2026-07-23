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
    pathname === "/callback" ||
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

    // Temporary bypass for testing MCP tool invocation without authentication
    if (env.TEST_MODE_TOOL_INVOCATION === 'true' && (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/sse"))) {
      if (url.pathname.startsWith("/sse")) {
        return new Response("data: mock sse event\n\n", {
          headers: { 'Content-Type': 'text/event-stream' },
          status: 200,
        });
      } else if (url.pathname.startsWith("/mcp")) {
        const requestBody = await request.json();
        if (requestBody.toolName === 'generateImage' && requestBody.args) {
          const { prompt, steps } = requestBody.args;
          const simulatedLogin = request.headers.get('X-MCP-User-Login');
          // For testing, hardcode ALLOWED_USERNAMES as they are in src/include/tools.js
          const ALLOWED_USERNAMES_TEST = new Set(["PortNumber53"]);

          if (typeof prompt === 'string' && typeof steps === 'number') {
            if (simulatedLogin && ALLOWED_USERNAMES_TEST.has(simulatedLogin)) {
              // Mock AI response for image generation
              const mockImage = 'mock_image_data_base64'; // Base64 encoded dummy image
              return new Response(JSON.stringify({
                content: [{ data: mockImage, mimeType: 'image/jpeg', type: 'image' }],
              }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
              });
            } else {
              return new Response(JSON.stringify({ error: "Unauthorized access to generateImage tool" }), { status: 403 });
            }
          }
        } else if (requestBody.toolName === 'getProjectOverview' && requestBody.args) {
          if (requestBody.args.listProjects === true) {
            return new Response(JSON.stringify({
              content: [{ text: 'Found 1 projects:\n- TEST: Test Project', type: "text" }],
              data: { success: true, projects: [{ id: '1', key: 'TEST', name: 'Test Project', projectTypeKey: 'software' }] },
            }), {
              headers: { 'Content-Type': 'application/json' },
              status: 200,
            });
          }
          if (requestBody.args.projectKey) {
            return new Response(JSON.stringify({
              content: [{ text: `Project: Test Project (${requestBody.args.projectKey})\nLead: Test Lead\n\nNo active sprint.\n\nBacklog: 3 issues\nIssue types: Task, Bug, Story`, type: "text" }],
              data: { success: true, project: { key: requestBody.args.projectKey, name: 'Test Project' }, backlogCount: 3, issueTypes: [{ id: '10001', name: 'Task', subtask: false }, { id: '10002', name: 'Bug', subtask: false }] },
            }), {
              headers: { 'Content-Type': 'application/json' },
              status: 200,
            });
          }
        } else if (requestBody.toolName === 'deleteComment' && requestBody.args) {
          const { issueKey, commentId } = requestBody.args;
          if (typeof issueKey === 'string' && typeof commentId === 'string') {
            return new Response(JSON.stringify({
              content: [{ text: `Comment ${commentId} deleted from issue ${issueKey}.`, type: "text" }],
              data: { success: true, issueKey, commentId, deleted: true },
            }), {
              headers: { 'Content-Type': 'application/json' },
              status: 200,
            });
          }
        }
        return new Response(JSON.stringify({ error: "Tool invocation failed in test mode" }), { status: 400 });
      }
      return new Response("Not Found in test bypass", { status: 404 });
    }


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
