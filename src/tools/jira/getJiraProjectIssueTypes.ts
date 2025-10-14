import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JiraClient } from "../jira";

export function registerGetJiraProjectIssueTypesTool(server: McpServer, jiraClient: JiraClient) {
  server.tool(
    "getJiraProjectIssueTypes",
    "Get all available issue types for a Jira project, including subtask types",
    {
      projectIdOrKey: z.string().describe("[REQUIRED] ID or key of the project to retrieve issue types for"),
    },
    async ({ projectIdOrKey }) => {
      try {
        const issueTypes = await jiraClient.getProjectIssueTypes(projectIdOrKey);
        if (!issueTypes || issueTypes.length === 0) {
          return {
            content: [{ text: `No issue types found for project ${projectIdOrKey}.`, type: "text" }],
            data: {
              success: true,
              projectKey: projectIdOrKey,
              issueTypes: [],
              subtaskTypes: [],
              standardTypes: []
            }
          };
        }
        const subtaskTypes = issueTypes.filter(type => type && type.subtask === true);
        const standardTypes = issueTypes.filter(type => type && type.subtask !== true);
        let result = `Issue types for project ${projectIdOrKey}:\n\n`;
        result += "Standard Issue Types:\n";
        if (standardTypes.length > 0) {
          standardTypes.forEach(type => {
            result += `- ${type.name} (ID: ${type.id})${type.default ? ' [DEFAULT]' : ''}\n`;
          });
        } else {
          result += "- None found\n";
        }
        result += "\nSubtask Issue Types:\n";
        if (subtaskTypes.length > 0) {
          subtaskTypes.forEach(type => {
            result += `- ${type.name} (ID: ${type.id})${type.default ? ' [DEFAULT]' : ''}\n`;
          });
        } else {
          result += "- None found (this project may not support subtasks)\n";
        }
        const responseData = {
          success: true,
          projectKey: projectIdOrKey,
          issueTypes: issueTypes.map(type => ({
            id: type.id,
            name: type.name,
            subtask: type.subtask === true,
            default: type.default === true
          })),
          subtaskTypes: subtaskTypes.map(type => ({
            id: type.id,
            name: type.name,
            default: type.default === true
          })),
          standardTypes: standardTypes.map(type => ({
            id: type.id,
            name: type.name,
            default: type.default === true
          }))
        };
        const responseJson = JSON.stringify(responseData, null, 2);
        return {
          content: [
            { text: result, type: "text" },
            { text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" }
          ],
          data: responseData
        };
      } catch (error: any) {
        const errorMessage = `Error retrieving issue types: ${error?.message || 'Unknown error'}`;
        const errorJson = JSON.stringify({
          success: false,
          error: errorMessage,
          projectKey: projectIdOrKey
        }, null, 2);
        return {
          content: [
            { text: errorMessage, type: "text" },
            { text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" }
          ],
          data: {
            success: false,
            error: errorMessage,
            projectKey: projectIdOrKey
          }
        };
      }
    }
  );
}
