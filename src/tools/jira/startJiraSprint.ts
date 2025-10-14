import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerStartJiraSprintTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "startJiraSprint",
    "Start a Jira sprint",
    {
      sprintId: z.number().describe("[REQUIRED] ID of the sprint to start."),
      startDate: z.string().optional().describe("[OPTIONAL] Start date in ISO format (e.g., '2025-06-30T08:00:00.000Z'). If not provided, sprint will be started immediately."),
      endDate: z.string().optional().describe("[OPTIONAL] End date in ISO format (e.g., '2025-07-14T17:00:00.000Z'). Should be after startDate."),
      goal: z.string().optional().describe("[OPTIONAL] Sprint goal - brief description of what the team aims to achieve in this sprint.")
    },
    async ({ sprintId, startDate, endDate, goal }) => {
      const payload: any = {};
      if (startDate) payload.startDate = startDate;
      if (endDate) payload.endDate = endDate;
      if (goal) payload.goal = goal;
      const startedSprint = await jiraClient.startSprint(sprintId, payload);
      return {
        content: [{ text: `Sprint started: ${startedSprint.id} - ${startedSprint.name}`, type: "text" }],
      };
    }
  );
}
