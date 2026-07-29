import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../src/tools/jira/index.js";
import { buildTenantJiraEnv, type McpEnv, type Props } from "./jira-env.js";
import { registerTools } from "../src/include/tools.js";
import { integrationRegistry } from "../src/integrations/index.js";

export type SessionContext = {
  server: McpServer;
  getJiraClient: () => Promise<JiraClient>;
  props: Props | undefined;
  env: McpEnv;
};

export async function createSessionContext(
  env: McpEnv,
  props: Props | undefined,
): Promise<{ context: SessionContext; cleanup: () => Promise<void> }> {
  let jiraClient: JiraClient | null = null;

  const getJiraClient = async (): Promise<JiraClient> => {
    if (jiraClient) return jiraClient;
    const jiraEnv = await buildTenantJiraEnv(env, props);
    jiraClient = new JiraClient(jiraEnv as any);
    return jiraClient;
  };

  const server = new McpServer({
    name: "mcp-jira-thing",
    version: "1.0.0",
  });

  const context: SessionContext = {
    server,
    getJiraClient,
    props,
    env,
  };

  await registerTools.call(context);

  const integrationCtx = {
    env: env as unknown as Record<string, unknown>,
    backendBaseUrl: env.BACKEND_BASE_URL,
    userEmail: props?.login,
  };
  await integrationRegistry.activateAll(integrationCtx);

  server.tool(
    "listIntegrations",
    "List all registered third-party integration modules and their status (enabled, configured, errors).",
    {},
    async () => {
      const statuses = await integrationRegistry.getStatuses(integrationCtx);
      const lines = statuses.map(
        (s) =>
          `${s.name} (${s.id}): ${s.enabled ? "enabled" : "disabled"}, ${s.configured ? "configured" : "not configured"}${s.error ? ` — ${s.error}` : ""}`,
      );
      return {
        content: [{ text: lines.length > 0 ? lines.join("\n") : "No integrations registered.", type: "text" }],
        data: { success: true, integrations: statuses },
      };
    },
  );

  const cleanup = async () => {
    await integrationRegistry.teardownAll();
  };

  return { context, cleanup };
}
