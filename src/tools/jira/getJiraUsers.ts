import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerGetJiraUsersTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "getJiraUsers",
    "Find Jira users to get valid account IDs for project creation",
    {
      query: z.string().describe("[REQUIRED] Search query for users - can be a name, email, or username. Partial matches are supported (e.g., 'john', 'smith@example.com')."),
      maxResults: z.number().optional().describe("[OPTIONAL] Maximum number of results to return. Default is 50 if not specified. Use a smaller number for more focused results.")
    },
    async ({ query, maxResults }) => {
      try {
        console.log("[mcp] getJiraUsers: received request", { query, maxResults });
        const response = await jiraClient.searchUsers(query, maxResults ?? 10);
        console.log("[mcp] getJiraUsers: Jira responded", {
          query,
          count: Array.isArray(response) ? response.length : null,
          type: typeof response,
        });
        if (!Array.isArray(response) || response.length === 0) {
          return {
            content: [{ text: `No users found matching \"${query}\"`, type: "text" }],
          };
        }
        const formattedUsers = response.map((user: any) => ({
          displayName: user.displayName,
          email: user.emailAddress || null,
          accountId: user.accountId,
          active: user.active
        }));
        const usersText = formattedUsers.map(user => {
          return `- ${user.displayName}\n  Account ID: ${user.accountId}\n  Email: ${user.email || 'None'}\n  Active: ${user.active ? 'Yes' : 'No'}`;
        }).join('\n\n');
        const usersJson = JSON.stringify(formattedUsers, null, 2);
        return {
          content: [
            {
              text: `Found ${response.length} users matching \"${query}\":\n\n${usersText}\n\nUse the accountId value when creating projects.`,
              type: "text"
            },
            {
              text: `MACHINE_PARSEABLE_DATA:\n${usersJson}`,
              type: "text"
            }
          ],
        };
      } catch (error: any) {
        console.error("[mcp] getJiraUsers: error searching for users", {
          query,
          maxResults,
          message: error?.message,
          stack: error?.stack,
        });
        const errorMessage = `Error searching for users: ${error?.message || "Unknown error"}`;
        const errorJson = JSON.stringify({
          error: true,
          message: error?.message || 'Unknown error',
          query: query
        }, null, 2);
        return {
          content: [
            { text: errorMessage, type: "text" },
            { text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
          ],
        };
      }
    }
  );
}
