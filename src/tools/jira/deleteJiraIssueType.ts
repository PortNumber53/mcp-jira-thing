import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerDeleteJiraIssueTypeTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "deleteJiraIssueType",
    "Delete a Jira issue type. Parameters: issueTypeId (required), alternativeIssueTypeId (optional: to replace issues of deleted type)",
    {
      issueTypeId: z.string().describe("[REQUIRED] ID of the issue type to delete."),
      alternativeIssueTypeId: z.string().optional().describe("[OPTIONAL] ID of an alternative issue type to replace the deleted type.")
    },
    async ({ issueTypeId, alternativeIssueTypeId }) => {
      await jiraClient.issueTypes.deleteIssueType(issueTypeId, alternativeIssueTypeId);
      return {
        content: [{ text: `Deleted issue type ${issueTypeId}.`, type: "text" }],
      };
    }
  );
}
