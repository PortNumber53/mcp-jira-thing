// Thin Worker: serves static SPA assets only.
// All API routes, OAuth flows, and billing are handled by the Go backend directly.

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

function acceptsHtml(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").includes("text/html");
}

async function serveAsset(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    // In local dev without ASSETS binding, proxy to the Vite dev server
    const viteUrl = new URL(request.url);
    viteUrl.host = "localhost:18110";
    return fetch(viteUrl.toString(), request);
  }

  const response = await env.ASSETS.fetch(request);
  const hasFileExtension = /\.[^/]+$/.test(url.pathname);

  // SPA fallback: serve index.html for client-side routes
  if (response.status === 404 && request.method === "GET" && !hasFileExtension && acceptsHtml(request)) {
    const rootUrl = new URL("/", url);
    return env.ASSETS.fetch(new Request(rootUrl.toString(), request));
  }

  return response;
}

export async function handleFrontendFetch(
  request: Request,
  env: Env,
  _ctx: unknown,
): Promise<Response> {
  const url = new URL(request.url);
  return serveAsset(request, env, url);
}
