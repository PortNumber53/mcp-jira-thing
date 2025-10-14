import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerGetProjectsTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "getProjects",
    "Get a list of all Jira projects",
    {},
    async () => {
      const projects = await jiraClient.getProjects();
      console.log('JiraProjects.getProjects raw result:', projects);
      const projectsText = projects.map((project: any) => `${project.name} (${project.key})`).join('\n');
      console.log('Formatted projectsText for tool output:', projectsText);
      return {
        content: [{ text: `Jira Projects:\n${projectsText}`, type: "text" }],
      };
    }
  );
}
