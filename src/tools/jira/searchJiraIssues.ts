import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerSearchJiraIssuesTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "searchJiraIssues",
    "Search for Jira issues using JQL",
    {
      jql: z.string().describe("[REQUIRED] JQL query string - Jira Query Language for filtering issues (e.g., 'project=TEST AND status=Open', 'assignee=currentUser()')."),
      maxResults: z.number().optional().describe("[OPTIONAL] Maximum number of results to return. Default is 50 if not specified. Maximum allowed is 100.")
    },
    async ({ jql, maxResults }) => {
      const searchResults = await jiraClient.searchIssues(jql, maxResults);
      const issuesText = searchResults.issues.map(issue => `${issue.key}: ${issue.fields.summary}`).join('\n');
      return {
        content: [{ text: `Found ${searchResults.total} issues:\n${issuesText}`, type: "text" }],
      };
    }
  );
}
