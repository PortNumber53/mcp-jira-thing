import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerCreateJiraSprintTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "createJiraSprint",
    "Create a new Jira sprint",
    {
      name: z.string().describe("[REQUIRED] Sprint name - descriptive name for the sprint (e.g., 'Sprint 1', 'June Release')."),
      originBoardId: z.number().describe("[REQUIRED] Board ID to create the sprint in - numeric ID of the Scrum board (e.g., 123). Get this from your board URL."),
      startDate: z.string().optional().describe("[OPTIONAL] Start date in ISO format (e.g., '2025-06-30T08:00:00.000Z'). If not provided, sprint will be created in future state."),
      endDate: z.string().optional().describe("[OPTIONAL] End date in ISO format (e.g., '2025-07-14T17:00:00.000Z'). Should be after startDate."),
      goal: z.string().optional().describe("[OPTIONAL] Sprint goal - brief description of what the team aims to achieve in this sprint.")
    },
    async ({ name, startDate, endDate, originBoardId, goal }) => {
      const payload: any = { name, originBoardId };
      if (startDate) payload.startDate = startDate;
      if (endDate) payload.endDate = endDate;
      if (goal) payload.goal = goal;
      const newSprint = await jiraClient.createSprint(payload);
      return {
        content: [{ text: `Sprint created: ${newSprint.id} - ${newSprint.name}`, type: "text" }],
      };
    }
  );
}
