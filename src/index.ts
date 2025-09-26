import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Octokit } from "octokit";
import { z } from "zod";
import { JiraClient } from "./tools/jira";
import { CreateIssueTypePayload, UpdateIssueTypePayload } from "./tools/jira/interfaces";
import { GitHubHandler } from "./github-handler";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
};

const ALLOWED_USERNAMES = new Set<string>([
  "PortNumber53",
  // Add GitHub usernames of users who should have access to the image generation tool
  // For example: 'yourusername', 'coworkerusername'
]);

interface Env {
  ATLASSIAN_API_KEY: string;
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  OAUTH_KV: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  AI: any; // Assuming 'AI' is a Cloudflare Workers AI binding
  MCP_OBJECT: DurableObjectNamespace<MyMCP>;
}

export class MyMCP extends McpAgent<Env, Props> {
  private jiraClient: JiraClient;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.jiraClient = new JiraClient(env);
  }

  server = new McpServer({
    name: "Github OAuth Proxy Demo",
    version: "1.0.0",
  });

  async init() {
    // Hello, world!
    this.server.tool("add", "Add two numbers the way only MCP can", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ text: String(a + b), type: "text" }],
    }));

    const IssueActionEnum = z.enum([
      "createIssue",
      "getIssue",
      "updateIssue",
      "deleteIssue",
      "searchIssues",
      "listComments",
      "addComment",
      "updateComment",
      "deleteComment",
      "getTransitions",
      "transitionIssue",
      "getLabels",
      "addLabels",
      "removeLabels",
      "setLabels",
      "listAttachments",
      "addAttachment",
      "deleteAttachment",
      "listPriorities",
      "setPriority",
      "listIssueTypes",
      "createIssueType",
      "getIssueType",
      "updateIssueType",
      "deleteIssueType",
      "getIssueTypeAlternatives",
    ]);
    const IssueActionSchema = z.union([z.literal("/help"), IssueActionEnum]);

    // Jira Tools
    this.server.tool("getProjects", "Get a list of all Jira projects", {}, async () => {
      const projects = await this.jiraClient.getProjects();
      console.log("JiraProjects.getProjects raw result:", projects);
      const projectsText = projects.map((project: any) => `${project.name} (${project.key})`).join("\n");
      console.log("Formatted projectsText for tool output:", projectsText);
      return {
        content: [{ text: `Jira Projects:\n${projectsText}`, type: "text" }],
      };
    });

    this.server.tool(
      "createJiraProject",
      "Create a new Jira project",
      {
        key: z
          .string()
          .describe(
            "[REQUIRED] Project key - must be uppercase, unique, and contain only letters and numbers (e.g., 'TEST', 'DEV', 'PROD'). Maximum 10 characters.",
          ),
        name: z.string().describe("[REQUIRED] Project name - descriptive name for the project (e.g., 'Test Project', 'Development Team')."),
        projectTypeKey: z
          .string()
          .describe(
            "[REQUIRED] Project type key - common values are 'software', 'business', or 'service_desk'. Check with your Jira admin for valid values.",
          ),
        leadAccountId: z
          .string()
          .describe(
            "[REQUIRED] Account ID of the project lead - use the 'getJiraUsers' tool to find valid account IDs. This is required by the Jira API.",
          ),
        projectTemplateKey: z
          .string()
          .optional()
          .describe(
            "[OPTIONAL/REQUIRED] Project template key - may be required depending on your Jira configuration. Common values include 'com.pyxis.greenhopper.jira:gh-scrum-template', 'com.pyxis.greenhopper.jira:gh-kanban-template'.",
          ),
        description: z
          .string()
          .optional()
          .describe("[OPTIONAL] Project description - detailed information about the project's purpose and scope."),
        url: z
          .string()
          .optional()
          .describe("[OPTIONAL] Project URL - web address associated with the project (e.g., 'https://example.com/project')."),
        assigneeType: z
          .string()
          .optional()
          .describe(
            "[OPTIONAL] Assignee type - determines default assignee behavior. Valid values: 'PROJECT_LEAD', 'UNASSIGNED'. Default is 'PROJECT_LEAD'.",
          ),
        avatarId: z
          .number()
          .optional()
          .describe("[OPTIONAL] Avatar ID - numeric ID of the avatar to use for the project. Omit to use default avatar."),
        categoryId: z
          .number()
          .optional()
          .describe("[OPTIONAL] Category ID - numeric ID of the project category to assign this project to."),
      },
      async (payload) => {
        try {
          const newProject = await this.jiraClient.createProject(payload);

          // Create a simplified project object for machine parsing
          const projectData = {
            id: newProject.id,
            key: newProject.key,
            name: newProject.name,
            projectTypeKey: newProject.projectTypeKey,
            description: newProject.description || null,
            lead: newProject.lead
              ? {
                  accountId: newProject.lead.accountId,
                  displayName: newProject.lead.displayName,
                }
              : null,
            success: true,
          };

          // Create JSON string for machine parsing
          const projectJson = JSON.stringify(projectData, null, 2);

          return {
            content: [
              { text: `Project created: ${newProject.name} (${newProject.key})`, type: "text" },
              { text: `MACHINE_PARSEABLE_DATA:\n${projectJson}`, type: "text" },
            ],
          };
        } catch (error: any) {
          // Type error as any to access error.message
          // Provide helpful error message
          let errorMessage = `Error creating project: ${error?.message || "Unknown error"}`;
          let errorType = "unknown";

          // Add specific guidance for common errors
          if (error?.message && typeof error.message === "string") {
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

          // Create error object for machine parsing
          const errorData = {
            success: false,
            errorType: errorType,
            message: error?.message || "Unknown error",
            payload: payload,
          };

          // Create JSON string for machine parsing
          const errorJson = JSON.stringify(errorData, null, 2);

          return {
            content: [
              { text: errorMessage, type: "text" },
              { text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" },
            ],
          };
        }
      },
    );

    this.server.tool(
      "getJiraProject",
      "Get details of a specific Jira project",
      {
        projectIdOrKey: z
          .string()
          .describe(
            "[REQUIRED] Project ID or key - either the numeric ID or the project key (e.g., 'TEST', '10000'). Project key is preferred.",
          ),
        expand: z
          .string()
          .optional()
          .describe(
            "[OPTIONAL] Comma-separated list of project properties to expand. Valid values include: 'description', 'lead', 'issueTypes', 'url', 'projectKeys', 'permissions', 'insight'",
          ),
      },
      async ({ projectIdOrKey, expand }) => {
        try {
          const project = await this.jiraClient.getProject(projectIdOrKey, expand);

          // Create a simplified project object for machine parsing
          const projectData = {
            id: project.id,
            key: project.key,
            name: project.name,
            projectTypeKey: project.projectTypeKey,
            description: project.description || null,
            lead: project.lead
              ? {
                  accountId: project.lead.accountId,
                  displayName: project.lead.displayName,
                }
              : null,
            success: true,
          };

          // Create JSON string for machine parsing
          const projectJson = JSON.stringify(projectData, null, 2);

          return {
            content: [
              {
                text:
                  `Project: ${project.name} (${project.key})\n` +
                  `ID: ${project.id}\n` +
                  `Description: ${project.description || "N/A"}\n` +
                  `Project Type: ${project.projectTypeKey}\n` +
                  `Lead: ${project.lead?.displayName || "N/A"}`,
                type: "text",
              },
              {
                text: `MACHINE_PARSEABLE_DATA:\n${projectJson}`,
                type: "text",
              },
            ],
          };
        } catch (error: any) {
          const errorMessage = `Error retrieving project: ${error?.message || "Unknown error"}`;
          const errorJson = JSON.stringify(
            {
              success: false,
              message: error?.message || "Unknown error",
              projectIdOrKey: projectIdOrKey,
            },
            null,
            2,
          );

          return {
            content: [
              { text: errorMessage, type: "text" },
              { text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" },
            ],
          };
        }
      },
    );

    this.server.tool(
      "getJiraProjectIssueTypes",
      "Get all available issue types for a Jira project, including subtask types",
      {
        projectIdOrKey: z.string().describe("[REQUIRED] ID or key of the project to retrieve issue types for"),
      },
      async ({ projectIdOrKey }) => {
        try {
          // Get all issue types available
          const issueTypes = await this.jiraClient.getProjectIssueTypes(projectIdOrKey);

          if (!issueTypes || issueTypes.length === 0) {
            return {
              content: [{ text: `No issue types found for project ${projectIdOrKey}.`, type: "text" }],
              data: {
                success: true,
                projectKey: projectIdOrKey,
                issueTypes: [],
                subtaskTypes: [],
                standardTypes: [],
              },
            };
          }

          // Separate subtask types from standard types
          const subtaskTypes = issueTypes.filter((type) => type && type.subtask === true);
          const standardTypes = issueTypes.filter((type) => type && type.subtask !== true);

          // Format a human-readable response
          let result = `Issue types for project ${projectIdOrKey}:\n\n`;

          result += "Standard Issue Types:\n";
          if (standardTypes.length > 0) {
            standardTypes.forEach((type) => {
              result += `- ${type.name} (ID: ${type.id})${type.default ? " [DEFAULT]" : ""}\n`;
            });
          } else {
            result += "- None found\n";
          }

          result += "\nSubtask Issue Types:\n";
          if (subtaskTypes.length > 0) {
            subtaskTypes.forEach((type) => {
              result += `- ${type.name} (ID: ${type.id})${type.default ? " [DEFAULT]" : ""}\n`;
            });
          } else {
            result += "- None found (this project may not support subtasks)\n";
          }

          // Create structured data for machine parsing
          const responseData = {
            success: true,
            projectKey: projectIdOrKey,
            issueTypes: issueTypes.map((type) => ({
              id: type.id,
              name: type.name,
              subtask: type.subtask === true,
              default: type.default === true,
            })),
            subtaskTypes: subtaskTypes.map((type) => ({
              id: type.id,
              name: type.name,
              default: type.default === true,
            })),
            standardTypes: standardTypes.map((type) => ({
              id: type.id,
              name: type.name,
              default: type.default === true,
            })),
          };

          // Create JSON string for machine parsing
          const responseJson = JSON.stringify(responseData, null, 2);

          return {
            content: [
              { text: result, type: "text" },
              { text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" },
            ],
            data: responseData,
          };
        } catch (error: any) {
          const errorMessage = `Error retrieving issue types: ${error?.message || "Unknown error"}`;
          const errorJson = JSON.stringify(
            {
              success: false,
              error: errorMessage,
              projectKey: projectIdOrKey,
            },
            null,
            2,
          );

          return {
            content: [
              { text: errorMessage, type: "text" },
              { text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" },
            ],
            data: {
              success: false,
              error: errorMessage,
              projectKey: projectIdOrKey,
            },
          };
        }
      },
    );

    this.server.tool(
      "jiraIssueToolkit",
      "Unified Jira issue tool covering issue CRUD, comments, statuses, labels, attachments, priorities, and issue types. Pass action='/help' for usage.",
      {
        action: IssueActionSchema.describe("Select the operation to run. Use '/help' to list supported actions."),
        issueIdOrKey: z.string().optional().describe("Issue key or ID for operations that target a single issue."),
        projectKey: z.string().optional().describe("Project key used when constructing a new issue."),
        summary: z.string().optional().describe("Issue summary/title used for create or update actions."),
        issueType: z
          .union([z.string(), z.object({ id: z.string().optional(), name: z.string().optional() })])
          .optional()
          .describe("Issue type reference for createIssue. Accepts a name, ID, or object with id/name."),
        description: z.string().optional().describe("Plain text description. Automatically converted to Atlassian document format."),
        fields: z.record(z.any()).optional().describe("Arbitrary field map for createIssue or updateIssue actions."),
        additionalFields: z.record(z.any()).optional().describe("Optional object merged into generated fields during createIssue."),
        jql: z.string().optional().describe("JQL query for searchIssues."),
        maxResults: z.number().optional().describe("Maximum results for searchIssues (defaults to Jira API)."),
        commentId: z.string().optional().describe("Comment ID for updateComment or deleteComment."),
        commentBody: z
          .union([z.string(), z.record(z.any())])
          .optional()
          .describe("Comment text or Atlassian document body."),
        labels: z.array(z.string()).optional().describe("Labels for label actions."),
        filename: z.string().optional().describe("Filename when uploading an attachment."),
        fileBase64: z.string().optional().describe("Base64-encoded file contents for addAttachment."),
        contentType: z.string().optional().describe("Optional MIME type for uploaded attachment."),
        attachmentId: z.string().optional().describe("Attachment ID for deleteAttachment."),
        transitionId: z.string().optional().describe("Transition ID for transitionIssue."),
        priorityId: z.string().optional().describe("Priority ID for setPriority."),
        priorityName: z.string().optional().describe("Priority name for setPriority when ID is unknown."),
        issueTypeId: z.string().optional().describe("Issue type ID for type-specific actions."),
        issueTypePayload: z.record(z.any()).optional().describe("Payload for createIssueType or updateIssueType."),
        alternativeIssueTypeId: z.string().optional().describe("Replacement issue type ID when deleting an issue type."),
        expand: z.string().optional().describe("Additional expand options when retrieving issues."),
      },
      async (input) => {
        if (input.action === "/help") {
          const helpText = `Supported actions:
- createIssue: create a Jira issue (supply fields or projectKey + summary + issueType)
- getIssue: fetch a single issue
- updateIssue: update specific fields on an issue
- deleteIssue: remove an issue
- searchIssues: run a JQL search
- listComments | addComment | updateComment | deleteComment: manage issue comments
- getTransitions | transitionIssue: inspect or execute workflow transitions
- getLabels | addLabels | removeLabels | setLabels: manage issue labels
- listAttachments | addAttachment | deleteAttachment: work with attachments (attachments require base64 payload)
- listPriorities | setPriority: inspect and set issue priority
- listIssueTypes | createIssueType | getIssueType | updateIssueType | deleteIssueType | getIssueTypeAlternatives: manage issue types (set projectKey on listIssueTypes to scope results).`;
          return {
            content: [{ text: helpText, type: "text" }],
          };
        }

        const action = input.action as z.infer<typeof IssueActionEnum>;

        const ensureIssue = () => {
          if (!input.issueIdOrKey) {
            throw new Error(`Action "${action}" requires issueIdOrKey.`);
          }
          return input.issueIdOrKey;
        };

        const ensureLabels = () => {
          if (!input.labels || input.labels.length === 0) {
            throw new Error(`Action "${action}" requires one or more labels.`);
          }
          return input.labels;
        };

        const normalizeIssueType = () => {
          if (!input.issueType) {
            throw new Error("issueType is required when fields are not provided.");
          }
          if (typeof input.issueType === "string") {
            if (/^\d+$/.test(input.issueType)) {
              return { id: input.issueType };
            }
            return { name: input.issueType };
          }
          if (!input.issueType.id && !input.issueType.name) {
            throw new Error("issueType object must include an id or name.");
          }
          return input.issueType;
        };

        const extractCommentText = () => {
          if (!input.commentBody) {
            return undefined;
          }
          if (typeof input.commentBody === "string") {
            return input.commentBody;
          }
          try {
            const doc = input.commentBody as { content?: Array<any> };
            const paragraphs = doc?.content ?? [];
            const text = paragraphs
              .flatMap((node: any) => node?.content || [])
              .map((node: any) => (typeof node?.text === "string" ? node.text : ""))
              .join(" ")
              .trim();
            return text || undefined;
          } catch (error) {
            console.warn("Failed to extract text from comment body document.");
            return undefined;
          }
        };

        switch (action) {
          case "createIssue": {
            let fields: Record<string, any> | undefined = input.fields || undefined;
            if (!fields) {
              if (!input.projectKey) {
                throw new Error("projectKey is required when fields are not provided.");
              }
              if (!input.summary) {
                throw new Error("summary is required when fields are not provided.");
              }
              const issueType = normalizeIssueType();
              fields = {
                project: { key: input.projectKey },
                summary: input.summary,
                issuetype: issueType,
              };
              if (input.description !== undefined) {
                fields.description = input.description;
              }
              if (input.additionalFields) {
                fields = { ...fields, ...input.additionalFields };
              }
            }
            const created = await this.jiraClient.createIssue(fields!);
            return {
              content: [{ text: `Issue created: ${created.key} (${created.id})`, type: "text" }],
              data: { success: true, issue: created },
            };
          }
          case "getIssue": {
            const issueIdOrKey = ensureIssue();
            const issue = await this.jiraClient.getIssue(issueIdOrKey);
            return {
              content: [{ text: `Issue ${issue.key}: ${issue.fields.summary}`, type: "text" }],
              data: { success: true, issue },
            };
          }
          case "updateIssue": {
            const issueIdOrKey = ensureIssue();
            const fields = { ...(input.fields || {}) };
            if (input.summary !== undefined) {
              fields.summary = input.summary;
            }
            if (input.description !== undefined) {
              fields.description = input.description;
            }
            if (Object.keys(fields).length === 0) {
              throw new Error("updateIssue requires at least one field to modify.");
            }
            await this.jiraClient.updateIssue(issueIdOrKey, fields);
            return {
              content: [{ text: `Issue ${issueIdOrKey} updated successfully.`, type: "text" }],
              data: { success: true, issueIdOrKey, updatedFields: Object.keys(fields) },
            };
          }
          case "deleteIssue": {
            const issueIdOrKey = ensureIssue();
            await this.jiraClient.deleteIssue(issueIdOrKey);
            return {
              content: [{ text: `Issue ${issueIdOrKey} deleted.`, type: "text" }],
              data: { success: true, issueIdOrKey },
            };
          }
          case "searchIssues": {
            if (!input.jql) {
              throw new Error("searchIssues requires a JQL query.");
            }
            const results = await this.jiraClient.searchIssues(input.jql, input.maxResults);
            return {
              content: [
                {
                  text: `Found ${results.total} issues. First page:\n${results.issues
                    .map((issue) => `${issue.key}: ${issue.fields.summary}`)
                    .join("\n")}`,
                  type: "text",
                },
              ],
              data: { success: true, ...results },
            };
          }
          case "listComments": {
            const issueIdOrKey = ensureIssue();
            const comments = await this.jiraClient.listIssueComments(issueIdOrKey);
            return {
              content: [{ text: `Found ${comments.comments.length} comments`, type: "text" }],
              data: { success: true, ...comments },
            };
          }
          case "addComment": {
            const issueIdOrKey = ensureIssue();
            if (!input.commentBody) {
              throw new Error("addComment requires commentBody.");
            }
            const comment = await this.jiraClient.addIssueComment(issueIdOrKey, input.commentBody as any);
            return {
              content: [{ text: `Comment ${comment.id} added to ${issueIdOrKey}.`, type: "text" }],
              data: { success: true, comment },
            };
          }
          case "updateComment": {
            const issueIdOrKey = ensureIssue();
            if (!input.commentId) {
              throw new Error("updateComment requires commentId.");
            }
            if (!input.commentBody) {
              throw new Error("updateComment requires commentBody.");
            }
            const comment = await this.jiraClient.updateIssueComment(issueIdOrKey, input.commentId, input.commentBody as any);
            return {
              content: [{ text: `Comment ${comment.id} updated.`, type: "text" }],
              data: { success: true, comment },
            };
          }
          case "deleteComment": {
            const issueIdOrKey = ensureIssue();
            if (!input.commentId) {
              throw new Error("deleteComment requires commentId.");
            }
            await this.jiraClient.deleteIssueComment(issueIdOrKey, input.commentId);
            return {
              content: [{ text: `Comment ${input.commentId} deleted.`, type: "text" }],
              data: { success: true, commentId: input.commentId },
            };
          }
          case "getTransitions": {
            const issueIdOrKey = ensureIssue();
            const transitions = await this.jiraClient.getTransitions(issueIdOrKey);
            return {
              content: [
                {
                  text:
                    transitions.transitions.map((t: any) => `${t.id}: ${t.name} → ${t.to?.name}`).join("\n") || "No transitions available",
                  type: "text",
                },
              ],
              data: { success: true, ...transitions },
            };
          }
          case "transitionIssue": {
            const issueIdOrKey = ensureIssue();
            if (!input.transitionId) {
              throw new Error("transitionIssue requires transitionId.");
            }
            const transitionComment = extractCommentText();
            await this.jiraClient.doTransition(issueIdOrKey, input.transitionId, transitionComment);
            return {
              content: [{ text: `Issue ${issueIdOrKey} transitioned using ${input.transitionId}.`, type: "text" }],
              data: { success: true, issueIdOrKey, transitionId: input.transitionId },
            };
          }
          case "getLabels": {
            const issueIdOrKey = ensureIssue();
            const labels = await this.jiraClient.getLabelsForIssue(issueIdOrKey);
            return {
              content: [{ text: labels.length ? labels.join(", ") : "No labels set", type: "text" }],
              data: { success: true, labels },
            };
          }
          case "addLabels": {
            const issueIdOrKey = ensureIssue();
            const labels = ensureLabels();
            await this.jiraClient.addLabels(issueIdOrKey, labels);
            return {
              content: [{ text: `Added labels to ${issueIdOrKey}.`, type: "text" }],
              data: { success: true, issueIdOrKey, labels },
            };
          }
          case "removeLabels": {
            const issueIdOrKey = ensureIssue();
            const labels = ensureLabels();
            await this.jiraClient.removeLabels(issueIdOrKey, labels);
            return {
              content: [{ text: `Removed labels from ${issueIdOrKey}.`, type: "text" }],
              data: { success: true, issueIdOrKey, labels },
            };
          }
          case "setLabels": {
            const issueIdOrKey = ensureIssue();
            const labels = input.labels || [];
            await this.jiraClient.setLabels(issueIdOrKey, labels);
            return {
              content: [{ text: `Labels on ${issueIdOrKey} set to [${labels.join(", ")}].`, type: "text" }],
              data: { success: true, issueIdOrKey, labels },
            };
          }
          case "listAttachments": {
            const issueIdOrKey = ensureIssue();
            const attachments = await this.jiraClient.getIssueAttachments(issueIdOrKey);
            return {
              content: [{ text: `Found ${attachments.length} attachments.`, type: "text" }],
              data: { success: true, attachments },
            };
          }
          case "addAttachment": {
            const issueIdOrKey = ensureIssue();
            if (!input.filename) {
              throw new Error("addAttachment requires filename.");
            }
            if (!input.fileBase64) {
              throw new Error("addAttachment requires fileBase64. Provide raw base64 without the data URI prefix.");
            }
            const base64 = input.fileBase64.includes(",") ? input.fileBase64.split(",").pop()! : input.fileBase64;
            const attachments = await this.jiraClient.addIssueAttachment(issueIdOrKey, input.filename, base64, input.contentType);
            return {
              content: [{ text: `Uploaded attachment(s) to ${issueIdOrKey}.`, type: "text" }],
              data: { success: true, attachments },
            };
          }
          case "deleteAttachment": {
            if (!input.attachmentId) {
              throw new Error("deleteAttachment requires attachmentId.");
            }
            await this.jiraClient.deleteIssueAttachment(input.attachmentId);
            return {
              content: [{ text: `Attachment ${input.attachmentId} deleted.`, type: "text" }],
              data: { success: true, attachmentId: input.attachmentId },
            };
          }
          case "listPriorities": {
            const priorities = await this.jiraClient.listPriorities();
            return {
              content: [{ text: priorities.map((p) => `${p.id}: ${p.name}`).join("\n"), type: "text" }],
              data: { success: true, priorities },
            };
          }
          case "setPriority": {
            const issueIdOrKey = ensureIssue();
            if (!input.priorityId && !input.priorityName) {
              throw new Error("setPriority requires priorityId or priorityName.");
            }
            const priorityField = input.priorityId ? { id: input.priorityId } : { name: input.priorityName };
            await this.jiraClient.updateIssue(issueIdOrKey, { priority: priorityField });
            return {
              content: [{ text: `Priority updated for ${issueIdOrKey}.`, type: "text" }],
              data: { success: true, issueIdOrKey, priority: priorityField },
            };
          }
          case "listIssueTypes": {
            if (input.projectKey) {
              const issueTypes = await this.jiraClient.getProjectIssueTypes(input.projectKey);
              const standardTypes = issueTypes.filter((type: any) => type && type.subtask !== true);
              const subtaskTypes = issueTypes.filter((type: any) => type && type.subtask === true);
              return {
                content: [
                  {
                    text: `Project ${input.projectKey}: ${standardTypes.length} standard type(s), ${subtaskTypes.length} subtask type(s).`,
                    type: "text",
                  },
                ],
                data: {
                  success: true,
                  projectKey: input.projectKey,
                  issueTypes,
                  standardTypes,
                  subtaskTypes,
                },
              };
            }

            const issueTypes = await this.jiraClient.getAllIssueTypes();
            return {
              content: [{ text: `Found ${issueTypes.length} issue types.`, type: "text" }],
              data: { success: true, issueTypes },
            };
          }
          case "createIssueType": {
            if (!input.issueTypePayload) {
              throw new Error("createIssueType requires issueTypePayload.");
            }
            if (!input.issueTypePayload.name) {
              throw new Error("issueTypePayload.name is required.");
            }
            const created = await this.jiraClient.createIssueType(input.issueTypePayload as CreateIssueTypePayload);
            return {
              content: [{ text: `Issue type created: ${created.name} (${created.id})`, type: "text" }],
              data: { success: true, issueType: created },
            };
          }
          case "getIssueType": {
            if (!input.issueTypeId) {
              throw new Error("getIssueType requires issueTypeId.");
            }
            const issueType = await this.jiraClient.getIssueType(input.issueTypeId);
            return {
              content: [{ text: `Issue type ${issueType.name}`, type: "text" }],
              data: { success: true, issueType },
            };
          }
          case "updateIssueType": {
            if (!input.issueTypeId) {
              throw new Error("updateIssueType requires issueTypeId.");
            }
            if (!input.issueTypePayload || Object.keys(input.issueTypePayload).length === 0) {
              throw new Error("issueTypePayload must include fields to update.");
            }
            const updated = await this.jiraClient.updateIssueType(input.issueTypeId, input.issueTypePayload as UpdateIssueTypePayload);
            return {
              content: [{ text: `Issue type updated: ${updated.name}`, type: "text" }],
              data: { success: true, issueType: updated },
            };
          }
          case "deleteIssueType": {
            if (!input.issueTypeId) {
              throw new Error("deleteIssueType requires issueTypeId.");
            }
            await this.jiraClient.deleteIssueType(input.issueTypeId, input.alternativeIssueTypeId);
            return {
              content: [{ text: `Issue type ${input.issueTypeId} deleted.`, type: "text" }],
              data: { success: true, issueTypeId: input.issueTypeId },
            };
          }
          case "getIssueTypeAlternatives": {
            if (!input.issueTypeId) {
              throw new Error("getIssueTypeAlternatives requires issueTypeId.");
            }
            const alternatives = await this.jiraClient.getAlternativeIssueTypes(input.issueTypeId);
            return {
              content: [{ text: `Found ${alternatives.length} alternative issue types.`, type: "text" }],
              data: { success: true, alternatives },
            };
          }
          default:
            throw new Error(`Unsupported action: ${action}`);
        }
      },
    );

    this.server.tool(
      "getJiraUsers",
      "Find Jira users to get valid account IDs for project creation",
      {
        query: z
          .string()
          .describe(
            "[REQUIRED] Search query for users - can be a name, email, or username. Partial matches are supported (e.g., 'john', 'smith@example.com').",
          ),
        maxResults: z
          .number()
          .optional()
          .describe(
            "[OPTIONAL] Maximum number of results to return. Default is 50 if not specified. Use a smaller number for more focused results.",
          ),
      },
      async ({ query }) => {
        try {
          // Use the searchUsers method to find users
          const response = await this.jiraClient.searchUsers(query);

          if (!Array.isArray(response) || response.length === 0) {
            return {
              content: [{ text: `No users found matching "${query}"`, type: "text" }],
            };
          }

          // Format user information with account IDs in a structured way
          const formattedUsers = response.map((user: any) => ({
            displayName: user.displayName,
            email: user.emailAddress || null,
            accountId: user.accountId,
            active: user.active,
          }));

          // Create a structured text format for humans
          const usersText = formattedUsers
            .map((user) => {
              return `- ${user.displayName}\n  Account ID: ${user.accountId}\n  Email: ${user.email || "None"}\n  Active: ${user.active ? "Yes" : "No"}`;
            })
            .join("\n\n");

          // Create a JSON string for machine parsing
          const usersJson = JSON.stringify(formattedUsers, null, 2);

          return {
            content: [
              {
                text: `Found ${response.length} users matching "${query}":\n\n${usersText}\n\nUse the accountId value when creating projects.`,
                type: "text",
              },
              {
                text: `MACHINE_PARSEABLE_DATA:\n${usersJson}`,
                type: "text",
              },
            ],
          };
        } catch (error: any) {
          const errorMessage = `Error searching for users: ${error?.message || "Unknown error"}`;
          const errorJson = JSON.stringify(
            {
              error: true,
              message: error?.message || "Unknown error",
              query: query,
            },
            null,
            2,
          );

          return {
            content: [
              { text: errorMessage, type: "text" },
              { text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" },
            ],
          };
        }
      },
    );

    this.server.tool(
      "createJiraSprint",
      "Create a new Jira sprint",
      {
        name: z.string().describe("[REQUIRED] Sprint name - descriptive name for the sprint (e.g., 'Sprint 1', 'June Release')."),
        originBoardId: z
          .number()
          .describe(
            "[REQUIRED] Board ID to create the sprint in - numeric ID of the Scrum board (e.g., 123). Get this from your board URL.",
          ),
        startDate: z
          .string()
          .optional()
          .describe(
            "[OPTIONAL] Start date in ISO format (e.g., '2025-06-30T08:00:00.000Z'). If not provided, sprint will be created in future state.",
          ),
        endDate: z
          .string()
          .optional()
          .describe("[OPTIONAL] End date in ISO format (e.g., '2025-07-14T17:00:00.000Z'). Should be after startDate."),
        goal: z.string().optional().describe("[OPTIONAL] Sprint goal - brief description of what the team aims to achieve in this sprint."),
      },
      async ({ name, startDate, endDate, originBoardId, goal }) => {
        // Create payload with only the provided fields
        const payload: any = { name, originBoardId };

        // Add optional fields if provided
        if (startDate) payload.startDate = startDate;
        if (endDate) payload.endDate = endDate;
        if (goal) payload.goal = goal;

        const newSprint = await this.jiraClient.createSprint(payload);
        return {
          content: [{ text: `Sprint created: ${newSprint.id} - ${newSprint.name}`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "startJiraSprint",
      "Start a Jira sprint",
      {
        sprintId: z.number().describe("ID of the sprint to start"),
      },
      async ({ sprintId }) => {
        await this.jiraClient.startSprint(sprintId);
        return {
          content: [{ text: `Sprint ${sprintId} started successfully.`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "completeJiraSprint",
      "Complete a Jira sprint",
      {
        sprintId: z.number().describe("ID of the sprint to complete"),
      },
      async ({ sprintId }) => {
        await this.jiraClient.completeSprint(sprintId);
        return {
          content: [{ text: `Sprint ${sprintId} completed successfully.`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "getJiraSprint",
      "Get details of a Jira sprint",
      {
        sprintId: z.number().describe("ID of the sprint to retrieve"),
      },
      async ({ sprintId }) => {
        const sprint = await this.jiraClient.getSprint(sprintId);
        return {
          content: [{ text: `Sprint ${sprint.name} (ID: ${sprint.id}, State: ${sprint.state})`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "updateJiraSprint",
      "Update details of a Jira sprint",
      {
        sprintId: z.number().describe("ID of the sprint to update"),
        name: z.string().optional().describe("New name for the sprint"),
        startDate: z.string().optional().describe("New start date for the sprint (YYYY-MM-DD)"),
        endDate: z.string().optional().describe("New end date for the sprint (YYYY-MM-DD)"),
        state: z.enum(["future", "active", "closed"]).optional().describe("New state for the sprint"),
        goal: z.string().optional().describe("New goal for the sprint"),
      },
      async ({ sprintId, name, startDate, endDate, state, goal }) => {
        const updatedSprint = await this.jiraClient.updateSprint(sprintId, { name, startDate, endDate, state, goal });
        return {
          content: [{ text: `Sprint updated: ${updatedSprint.name} (ID: ${updatedSprint.id})`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "deleteJiraSprint",
      "Delete a Jira sprint",
      {
        sprintId: z.number().describe("ID of the sprint to delete"),
      },
      async ({ sprintId }) => {
        await this.jiraClient.deleteSprint(sprintId);
        return {
          content: [{ text: `Sprint ${sprintId} deleted successfully.`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "getJiraSprintsForBoard",
      "Get all sprints for a given Jira board",
      {
        boardId: z.number().describe("ID of the Jira board"),
      },
      async ({ boardId }) => {
        const sprints = await this.jiraClient.getSprintsForBoard(boardId);
        const sprintsText = sprints.map((sprint) => `${sprint.name} (ID: ${sprint.id}, State: ${sprint.state})`).join("\n");
        return {
          content: [{ text: `Sprints for board ${boardId}:\n${sprintsText}`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "getJiraIssuesForSprint",
      "Get all issues for a given Jira sprint",
      {
        sprintId: z.number().describe("ID of the Jira sprint"),
      },
      async ({ sprintId }) => {
        const issues = await this.jiraClient.getIssuesForSprint(sprintId);
        const issuesText = issues.map((issue) => `${issue.key}: ${issue.fields.summary}`).join("\n");
        return {
          content: [{ text: `Issues for sprint ${sprintId}:\n${issuesText}`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "moveJiraIssuesToSprint",
      "Move issues to a Jira sprint",
      {
        sprintId: z.number().describe("ID of the target sprint"),
        issueIdsOrKeys: z.array(z.string()).describe("Array of issue IDs or keys to move"),
      },
      async ({ sprintId, issueIdsOrKeys }) => {
        await this.jiraClient.moveIssuesToSprint(sprintId, issueIdsOrKeys);
        return {
          content: [{ text: `Moved issues ${issueIdsOrKeys.join(", ")} to sprint ${sprintId}.`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "moveJiraIssuesToBacklog",
      "Move issues to the Jira backlog",
      {
        boardId: z.number().describe("ID of the Jira board"),
        issueIdsOrKeys: z.array(z.string()).describe("Array of issue IDs or keys to move"),
      },
      async ({ boardId, issueIdsOrKeys }) => {
        await this.jiraClient.moveIssuesToBacklog(boardId, issueIdsOrKeys);
        return {
          content: [{ text: `Moved issues ${issueIdsOrKeys.join(", ")} to backlog for board ${boardId}.`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "getJiraUser",
      "Get details of a Jira user",
      {
        accountId: z.string().describe("Account ID of the user to retrieve"),
      },
      async ({ accountId }) => {
        const user = await this.jiraClient.getUser(accountId);
        return {
          content: [{ text: `User: ${user.displayName} (Account ID: ${user.accountId}, Email: ${user.emailAddress})`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "createJiraUser",
      "Create a new Jira user",
      {
        emailAddress: z.string().describe("Email address of the new user"),
        password: z.string().describe("Password for the new user"),
        displayName: z.string().describe("Display name of the new user"),
      },
      async ({ emailAddress, password, displayName }) => {
        const newUser = await this.jiraClient.createUser({ emailAddress, password, displayName });
        return {
          content: [{ text: `User created: ${newUser.displayName} (Account ID: ${newUser.accountId})`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "deleteJiraUser",
      "Delete a Jira user",
      {
        accountId: z.string().describe("Account ID of the user to delete"),
      },
      async ({ accountId }) => {
        await this.jiraClient.deleteUser(accountId);
        return {
          content: [{ text: `User ${accountId} deleted successfully.`, type: "text" }],
        };
      },
    );

    // Use the upstream access token to facilitate tools
    this.server.tool("userInfoOctokit", "Get user info from GitHub, via Octokit", {}, async () => {
      const octokit = new Octokit({ auth: this.props.accessToken as string });
      return {
        content: [
          {
            text: JSON.stringify(await octokit.rest.users.getAuthenticated()),
            type: "text",
          },
        ],
      };
    });

    // Dynamically add tools based on the user's login. In this case, I want to limit
    // access to my Image Generation tool to just me
    if (ALLOWED_USERNAMES.has(this.props.login as string)) {
      this.server.tool(
        "generateImage",
        "Generate an image using the `flux-1-schnell` model. Works best with 8 steps.",
        {
          prompt: z.string().describe("A text description of the image you want to generate."),
          steps: z
            .number()
            .min(4)
            .max(8)
            .default(4)
            .describe(
              "The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive.",
            ),
        },
        async ({ prompt, steps }) => {
          const response = await this.env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
            prompt,
            steps,
          });

          return {
            content: [{ data: response.image!, mimeType: "image/jpeg", type: "image" }],
          };
        },
      );
    }
  }
}

export default new OAuthProvider({
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"),
    "/mcp": MyMCP.serve("/mcp"),
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: "/token",
});
