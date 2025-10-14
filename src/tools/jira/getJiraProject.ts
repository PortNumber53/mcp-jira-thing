import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerGetJiraProjectTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "getJiraProject",
    "Get details of a specific Jira project",
    {
      projectIdOrKey: z.string().describe("[REQUIRED] Project ID or key - either the numeric ID or the project key (e.g., 'TEST', '10000'). Project key is preferred."),
      expand: z.string().optional().describe("[OPTIONAL] Comma-separated list of project properties to expand. Valid values include: 'description', 'lead', 'issueTypes', 'url', 'projectKeys', 'permissions', 'insight'")
    },
    async ({ projectIdOrKey, expand }) => {
      try {
        const project = await jiraClient.getProject(projectIdOrKey, expand);
        const projectData = {
          id: project.id,
          key: project.key,
          name: project.name,
          projectTypeKey: project.projectTypeKey,
          description: project.description || null,
          lead: project.lead ? {
            accountId: project.lead.accountId,
            displayName: project.lead.displayName
          } : null,
          success: true
        };
        const projectJson = JSON.stringify(projectData, null, 2);
        return {
          content: [
            {
              text: `Project: ${project.name} (${project.key})\n` +
                `ID: ${project.id}\n` +
                `Description: ${project.description || 'N/A'}\n` +
                `Project Type: ${project.projectTypeKey}\n` +
                `Lead: ${project.lead?.displayName || 'N/A'}`,
              type: "text"
            },
            {
              text: `MACHINE_PARSEABLE_DATA:\n${projectJson}`,
              type: "text"
            }
          ],
        };
      } catch (error: any) {
        const errorMessage = `Error retrieving project: ${error?.message || 'Unknown error'}`;
        const errorJson = JSON.stringify({
          success: false,
          message: error?.message || 'Unknown error',
          projectIdOrKey: projectIdOrKey
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
