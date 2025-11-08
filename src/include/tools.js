// Placeholder module for MCP tool registration.
// TODO: Move all this.server.tool(...) registrations from src/index.ts into this file.

/**
 * Register MCP tools on the current MyMCP instance.
 * This function is intended to be called with `registerTools.call(this)`
 * from within the MyMCP.init method so that `this.server` and `this.getJiraClient`
 * are available.
 */
export async function registerTools() {
  // Tools are still defined inline in src/index.ts.
  // This stub keeps imports valid while we progressively refactor.
}
