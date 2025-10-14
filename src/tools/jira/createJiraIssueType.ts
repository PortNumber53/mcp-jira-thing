import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerCreateJiraIssueTypeTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "createJiraIssueType",
    "Create a new Jira issue type. Parameters: name (required), description (optional), type (optional: 'standard' or 'subtask'), hierarchyLevel (optional).",
    {
      name: z.string().describe("[REQUIRED] Name of the new issue type."),
      description: z.string().optional().describe("[OPTIONAL] Description of the issue type."),
      type: z.enum(["standard", "subtask"]).optional().describe("[OPTIONAL] Issue type kind: 'standard' or 'subtask'."),
      hierarchyLevel: z.number().optional().describe("[OPTIONAL] Hierarchy level for Advanced Roadmaps (e.g., 0=Epic, 1=Story, 2=Sub-task)")
    },
    async ({ name, description, type, hierarchyLevel }) => {
      const payload: any = { name };
      if (description) payload.description = description;
      if (type) payload.type = type;
      if (hierarchyLevel !== undefined) payload.hierarchyLevel = hierarchyLevel;
      const created = await jiraClient.issueTypes.createIssueType(payload);
      return {
        content: [{ text: `Created issue type: ${created.name} (ID: ${created.id})`, type: "text" }],
        issueType: created
      };
    }
  );
}
