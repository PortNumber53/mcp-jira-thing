import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerListJiraIssueTypesTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "listJiraIssueTypes",
    "List all Jira issue types available to the user.",
    {},
    async () => {
      const types = await jiraClient.issueTypes.getAllIssueTypes();
      return {
        content: [{ text: `Found ${types.length} issue types.`, type: "text" }],
        issueTypes: types
      };
    }
  );
}
