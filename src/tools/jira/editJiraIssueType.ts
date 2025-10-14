import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerEditJiraIssueTypeTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "editJiraIssueType",
    "Edit an existing Jira issue type. Parameters: issueTypeId (required), name (optional), description (optional), avatarId (optional)",
    {
      issueTypeId: z.string().describe("[REQUIRED] ID of the issue type to edit."),
      name: z.string().optional().describe("[OPTIONAL] New name for the issue type."),
      description: z.string().optional().describe("[OPTIONAL] New description."),
      avatarId: z.number().optional().describe("[OPTIONAL] New avatar ID.")
    },
    async ({ issueTypeId, name, description, avatarId }) => {
      const payload: any = {};
      if (name) payload.name = name;
      if (description) payload.description = description;
      if (avatarId !== undefined) payload.avatarId = avatarId;
      const updated = await jiraClient.issueTypes.updateIssueType(issueTypeId, payload);
      return {
        content: [{ text: `Updated issue type: ${updated.name} (ID: ${updated.id})`, type: "text" }],
        issueType: updated
      };
    }
  );
}
