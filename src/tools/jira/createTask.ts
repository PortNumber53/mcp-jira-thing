import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerCreateTaskTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "createTask",
    "Create a new Jira task",
    {
      projectKey: z.string().describe("[REQUIRED] The key of the Jira project (e.g., 'TEST', 'DEV', 'PROD'). Use the 'getProjects' tool to find valid project keys."),
      summary: z.string().describe("[REQUIRED] The summary/title of the task. Keep it concise but descriptive."),
      description: z.string().optional().describe("[OPTIONAL] A detailed description of the task. Supports Jira markdown formatting."),
    },
    async ({ projectKey, summary, description }) => {
      const newTask = await jiraClient.createTask(projectKey, summary, description);
      return {
        content: [{ text: `Task created: ${newTask.key} (${newTask.id})`, type: "text" }],
      };
    }
  );
}
