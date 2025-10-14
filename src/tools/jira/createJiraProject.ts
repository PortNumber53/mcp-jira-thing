import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerCreateJiraProjectTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "createJiraProject",
    "Create a new Jira project",
    {
      key: z.string().describe("[REQUIRED] Project key - must be uppercase, unique, and contain only letters and numbers (e.g., 'TEST', 'DEV', 'PROD'). Maximum 10 characters."),
      name: z.string().describe("[REQUIRED] Project name - descriptive name for the project (e.g., 'Test Project', 'Development Team')."),
      projectTypeKey: z.string().describe("[REQUIRED] Project type key - common values are 'software', 'business', or 'service_desk'. Check with your Jira admin for valid values."),
      leadAccountId: z.string().describe("[REQUIRED] Account ID of the project lead - use the 'getJiraUsers' tool to find valid account IDs. This is required by the Jira API."),
      projectTemplateKey: z.string().optional().describe("[OPTIONAL/REQUIRED] Project template key - may be required depending on your Jira configuration. Common values include 'com.pyxis.greenhopper.jira:gh-scrum-template', 'com.pyxis.greenhopper.jira:gh-kanban-template'."),
      description: z.string().optional().describe("[OPTIONAL] Project description - detailed information about the project's purpose and scope."),
      url: z.string().optional().describe("[OPTIONAL] Project URL - web address associated with the project (e.g., 'https://example.com/project')."),
      assigneeType: z.string().optional().describe("[OPTIONAL] Assignee type - determines default assignee behavior. Valid values: 'PROJECT_LEAD', 'UNASSIGNED'. Default is 'PROJECT_LEAD'."),
      avatarId: z.number().optional().describe("[OPTIONAL] Avatar ID - numeric ID of the avatar to use for the project. Omit to use default avatar."),
      categoryId: z.number().optional().describe("[OPTIONAL] Category ID - numeric ID of the project category to assign this project to."),
    },
    async (payload) => {
      try {
        const newProject = await jiraClient.createProject(payload);
        const projectData = {
          id: newProject.id,
          key: newProject.key,
          name: newProject.name,
          projectTypeKey: newProject.projectTypeKey,
          description: newProject.description || null,
          lead: newProject.lead ? {
            accountId: newProject.lead.accountId,
            displayName: newProject.lead.displayName
          } : null,
          success: true
        };
        const projectJson = JSON.stringify(projectData, null, 2);
        return {
          content: [
            { text: `Project created: ${newProject.name} (${newProject.key})`, type: "text" },
            { text: `MACHINE_PARSEABLE_DATA:\n${projectJson}`, type: "text" }
          ],
        };
      } catch (error: any) {
        let errorMessage = `Error creating project: ${error?.message || 'Unknown error'}`;
        let errorType = "unknown";
        if (error?.message && typeof error.message === 'string') {
          if (error.message.includes("projectLead")) {
            errorMessage += "\n\nYou must specify a valid leadAccountId. Use the 'getJiraUsers' tool to find valid account IDs.";
            errorType = "missing_lead";
          } else if (error.message.includes("projectTypeKey")) {
            errorMessage += "\n\nInvalid projectTypeKey. Common values are 'software', 'business', or 'service_desk'.";
            errorType = "invalid_project_type";
          } else if (error.message.includes("projectTemplateKey")) {
            errorMessage += "\n\nYour Jira instance requires a projectTemplateKey. Contact your Jira admin for valid template keys.";
            errorType = "missing_template";
          }
        }
        const errorData = {
          success: false,
          errorType: errorType,
          message: error?.message || 'Unknown error',
          payload: payload
        };
        const errorJson = JSON.stringify(errorData, null, 2);
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
