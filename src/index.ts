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

type Env = Cloudflare.Env & {
  // Optional session secret (legacy compatibility handled elsewhere)
  SESSION_SECRET?: string;
  // Additional bindings used by this Worker
  AI: any;
  MCP_OBJECT: DurableObjectNamespace<MyMCP>;
};

function extractFirstAppLocation(error: unknown): string | undefined {
  const stack = (error as any)?.stack;
  if (typeof stack !== "string" || stack.length === 0) return undefined;
  try {
    const lines = stack.split("\n");
    // Prefer frames from our project under /src/
    const candidate = lines.find((l) => l.includes("/src/")) || lines[1] || lines[0];
    if (!candidate) return undefined;
    // Extract file:line:column from stack frame
    const match = candidate.match(/(\/[^\s)]+:\d+:\d+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
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
      "listCommentsFull",
      "addComment",
      "updateComment",
      "deleteComment",
      "getComment",
      "getCommentsByIds",
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
          const location = extractFirstAppLocation(error);
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
            location,
          };

          // Create JSON string for machine parsing
          const errorJson = JSON.stringify(errorData, null, 2);

          return {
            content: [
              { text: location ? `${errorMessage} (at ${location})` : errorMessage, type: "text" },
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
          const location = extractFirstAppLocation(error);
          const errorMessage = `Error retrieving project: ${error?.message || "Unknown error"}`;
          const errorJson = JSON.stringify(
            {
              success: false,
              message: error?.message || "Unknown error",
              projectIdOrKey: projectIdOrKey,
              location,
            },
            null,
            2,
          );

          return {
            content: [
              { text: location ? `${errorMessage} (at ${location})` : errorMessage, type: "text" },
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
          const location = extractFirstAppLocation(error);
          const errorMessage = `Error retrieving issue types: ${error?.message || "Unknown error"}`;
          const errorJson = JSON.stringify(
            {
              success: false,
              error: errorMessage,
              projectKey: projectIdOrKey,
              location,
            },
            null,
            2,
          );

          return {
            content: [
              { text: location ? `${errorMessage} (at ${location})` : errorMessage, type: "text" },
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
        fields: z
          .union([z.record(z.any()), z.string(), z.array(z.string())])
          .optional()
          .describe(
            "For create/update actions, provide a field map object. For read operations (getIssue, searchIssues), supply a comma-separated string or array of field keys.",
          ),
        additionalFields: z.record(z.any()).optional().describe("Optional object merged into generated fields during createIssue."),
        jql: z.string().optional().describe("JQL query for searchIssues."),
        maxResults: z.number().optional().describe("Maximum results for searchIssues (defaults to Jira API)."),
        commentId: z.string().optional().describe("Comment ID for updateComment or deleteComment."),
        commentBody: z
          .union([z.string(), z.record(z.any())])
          .optional()
          .describe("Comment text or Atlassian document body."),
        // Comment list and retrieval
        orderBy: z
          .string()
          .optional()
          .describe("Order comments by 'created' or 'updated' (Jira may also accept createdDate/updatedDate)."),
        ids: z.array(z.union([z.string(), z.number()])).optional().describe("List of comment IDs for getCommentsByIds."),
        // Comment write options
        visibility: z
          .object({
            type: z.union([z.literal("group"), z.literal("role")]),
            value: z.string().optional(),
            identifier: z.string().optional(),
          })
          .optional()
          .describe("Visibility restrictions for the comment."),
        commentProperties: z
          .array(z.record(z.any()))
          .optional()
          .describe("Arbitrary properties to attach to the comment."),
        notifyUsers: z.boolean().optional().describe("Notify users when updating a comment."),
        overrideEditableFlag: z
          .boolean()
          .optional()
          .describe("Override editable flag when updating a comment (admin use)."),
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
        expand: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe("Field expansions accepted by Jira (e.g., 'renderedFields', 'changelog')."),
        properties: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe("Issue properties to include when fetching issues."),
        fieldsByKeys: z.boolean().optional().describe("Treat provided field identifiers as keys instead of IDs when fetching issues."),
        updateHistory: z.boolean().optional().describe("Set true to update the issue history index when fetching an issue."),
        startAt: z.number().optional().describe("Index of the first search result to return (used with searchIssues)."),
      },
      async (input) => {
        if (input.action === "/help") {
          const helpText = `Supported actions:
- createIssue: create a Jira issue (supply fields or projectKey + summary + issueType)
- getIssue: fetch a single issue
- updateIssue: update specific fields on an issue
- deleteIssue: remove an issue
- searchIssues: run a JQL search
- listComments | listCommentsFull | addComment | updateComment | deleteComment | getComment | getCommentsByIds: manage issue comments
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

        const extractFieldMapInput = () => {
          if (!input.fields || typeof input.fields === "string" || Array.isArray(input.fields)) {
            return undefined;
          }
          return input.fields as Record<string, any>;
        };

        const extractFieldSelection = () => {
          if (!input.fields) {
            return undefined;
          }
          if (typeof input.fields === "string" || Array.isArray(input.fields)) {
            return input.fields;
          }
          return undefined;
        };

        switch (action) {
          case "createIssue": {
            let fields: Record<string, any> | undefined = extractFieldMapInput();
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
            const requestedFields = extractFieldSelection();
            const defaultFields = [
              "summary",
              "status",
              "description",
              "assignee",
              "priority",
              "issuetype",
              "reporter",
              "labels",
              "created",
              "updated",
            ];
            const fieldsForRequest = requestedFields ?? defaultFields;
            const issue = await this.jiraClient.getIssue(issueIdOrKey, {
              fields: fieldsForRequest,
              expand: input.expand,
              properties: input.properties,
              fieldsByKeys: input.fieldsByKeys,
              updateHistory: input.updateHistory,
            });
            const summary = issue.fields?.summary ?? "(no summary)";
            const status = issue.fields?.status?.name ?? "Unknown";
            const statusCategory = issue.fields?.status?.statusCategory?.name ?? undefined;
            const priority = issue.fields?.priority?.name ?? "Unspecified";
            const assignee = issue.fields?.assignee?.displayName ?? "Unassigned";
            const reporter = issue.fields?.reporter?.displayName ?? undefined;
            const issueType = issue.fields?.issuetype?.name ?? undefined;
            const descriptionText = this.jiraClient.documentToPlainText(issue.fields?.description) ?? "No description provided.";
            const labels = Array.isArray(issue.fields?.labels) && issue.fields.labels.length > 0 ? issue.fields.labels.join(", ") : "None";
            const responseData = {
              key: issue.key,
              summary,
              status,
              statusCategory,
              priority,
              assignee,
              reporter,
              issueType,
              labels: labels === "None" ? [] : (issue.fields?.labels ?? []),
              description: descriptionText,
              created: issue.fields?.created,
              updated: issue.fields?.updated,
              raw: issue,
            };
            return {
              content: [{ text: JSON.stringify(responseData, null, 2), type: "text" }],
              data: { success: true, issue },
            };
          }
          case "updateIssue": {
            const issueIdOrKey = ensureIssue();
            const fields = { ...(extractFieldMapInput() || {}) };
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
            const results = await this.jiraClient.searchIssues(input.jql, {
              maxResults: input.maxResults,
              startAt: input.startAt,
              fields: extractFieldSelection(),
              expand: input.expand,
              properties: input.properties,
              fieldsByKeys: input.fieldsByKeys,
            });
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
            const comments = await this.jiraClient.listIssueComments(issueIdOrKey, {
              startAt: input.startAt,
              maxResults: input.maxResults,
              orderBy: input.orderBy,
              expand: input.expand,
            });
            return {
              content: [{ text: `Found ${comments.comments.length} comments`, type: "text" }],
              data: { success: true, ...comments },
            };
          }
          case "listCommentsFull": {
            const issueIdOrKey = ensureIssue();
            const commentsPage = await this.jiraClient.listIssueComments(issueIdOrKey, {
              startAt: input.startAt,
              maxResults: input.maxResults,
              orderBy: input.orderBy,
              // include renderedBody just in case callers want it
              expand: input.expand ?? "renderedBody",
            });
            const comments = commentsPage.comments || [];
            const plainTexts = comments.map((c: any) => this.jiraClient.documentToPlainText(c.body) || "");
            const result = {
              success: true,
              count: comments.length,
              ids: comments.map((c: any) => c.id),
              texts: plainTexts,
              comments,
              startAt: (commentsPage as any).startAt ?? 0,
              maxResults: (commentsPage as any).maxResults,
              total: (commentsPage as any).total,
            };
            return {
              content: [{ text: `Found ${comments.length} comments (full)`, type: "text" }],
              data: result,
            };
          }
          case "addComment": {
            const issueIdOrKey = ensureIssue();
            if (!input.commentBody) {
              throw new Error("addComment requires commentBody.");
            }
            const comment = await this.jiraClient.addIssueComment(issueIdOrKey, input.commentBody as any, {
              visibility: input.visibility as any,
              properties: input.commentProperties,
              expand: input.expand,
            });
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
            const comment = await this.jiraClient.updateIssueComment(issueIdOrKey, input.commentId, input.commentBody as any, {
              visibility: input.visibility as any,
              properties: input.commentProperties,
              notifyUsers: input.notifyUsers,
              overrideEditableFlag: input.overrideEditableFlag,
              expand: input.expand,
            });
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
          case "getComment": {
            const issueIdOrKey = ensureIssue();
            if (!input.commentId) {
              throw new Error("getComment requires commentId.");
            }
            const comment = await this.jiraClient.getIssueComment(issueIdOrKey, input.commentId);
            return {
              content: [{ text: JSON.stringify(comment, null, 2), type: "text" }],
              data: { success: true, comment },
            };
          }
          case "getCommentsByIds": {
            if (!input.ids || input.ids.length === 0) {
              throw new Error("getCommentsByIds requires 'ids' array.");
            }
            const page = await this.jiraClient.getIssueCommentsByIds(input.ids, input.expand);
            return {
              content: [{ text: `Fetched ${page.values.length} comments by IDs.`, type: "text" }],
              data: { success: true, ...page },
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
          const location = extractFirstAppLocation(error);
          const errorMessage = `Error searching for users: ${error?.message || "Unknown error"}`;
          const errorJson = JSON.stringify(
            {
              error: true,
              message: error?.message || "Unknown error",
              query: query,
              location,
            },
            null,
            2,
          );

          return {
            content: [
              { text: location ? `${errorMessage} (at ${location})` : errorMessage, type: "text" },
              { text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" },
            ],
          };
        }
      },
    );

    // Jira Dashboards unified tool
    const DashboardActionEnum = z.enum([
      "listDashboards",
      "getDashboard",
      "createDashboard",
      "updateDashboard",
      "deleteDashboard",
      "searchDashboards",
      "getAvailableGadgets",
      "getGadgets",
      "addGadget",
      "updateGadget",
      "removeGadget",
      "getDashboardItemPropertyKeys",
      "getDashboardItemProperty",
      "setDashboardItemProperty",
      "deleteDashboardItemProperty",
      "copyDashboard",
    ]);
    const DashboardActionSchema = z.union([z.literal("/help"), DashboardActionEnum]);

    this.server.tool(
      "jiraDashboardToolkit",
      "Manage Jira dashboards, gadgets, and item properties. Pass action='/help' for usage.",
      {
        action: DashboardActionSchema,
        // common identifiers
        id: z.string().optional().describe("Dashboard ID"),
        dashboardId: z.string().optional().describe("Dashboard ID (alias)"),
        gadgetId: z.string().optional().describe("Gadget ID"),
        itemId: z.string().optional().describe("Dashboard item ID"),
        propertyKey: z.string().optional().describe("Dashboard item property key"),
        // paging/filter
        filter: z.string().optional().describe("Filter string for dashboard list/search"),
        startAt: z.number().optional().describe("Pagination start index"),
        maxResults: z.number().optional().describe("Pagination max results"),
        // dashboard payload fields
        name: z.string().optional().describe("Dashboard name"),
        description: z.string().optional().describe("Dashboard description"),
        sharePermissions: z.array(z.record(z.any())).optional().describe("Share permissions array"),
        editPermissions: z.array(z.record(z.any())).optional().describe("Edit permissions array"),
        dashboardPayload: z.record(z.any()).optional().describe("Raw dashboard payload override"),
        // gadgets
        gadgetPayload: z.record(z.any()).optional().describe("Gadget payload for add/update"),
        // properties
        propertyValue: z.record(z.any()).optional().describe("Value for dashboard item property"),
        // copy options
        extendAdminPermissions: z.boolean().optional(),
      },
      async (input) => {
        if (input.action === "/help") {
          const helpText = `Supported dashboard actions:\n\n` +
            `- listDashboards | searchDashboards [filter,startAt,maxResults]\n` +
            `- getDashboard (id)\n` +
            `- createDashboard (name, description?, sharePermissions[], editPermissions[])\n` +
            `- updateDashboard (id, name/description/permissions or dashboardPayload)\n` +
            `- deleteDashboard (id)\n` +
            `- getAvailableGadgets\n` +
            `- getGadgets (dashboardId)\n` +
            `- addGadget (dashboardId, gadgetPayload)\n` +
            `- updateGadget (dashboardId, gadgetId, gadgetPayload)\n` +
            `- removeGadget (dashboardId, gadgetId)\n` +
            `- getDashboardItemPropertyKeys (dashboardId, itemId)\n` +
            `- getDashboardItemProperty (dashboardId, itemId, propertyKey)\n` +
            `- setDashboardItemProperty (dashboardId, itemId, propertyKey, propertyValue)\n` +
            `- deleteDashboardItemProperty (dashboardId, itemId, propertyKey)\n` +
            `- copyDashboard (id, dashboardPayload, extendAdminPermissions?)`;
          return { content: [{ type: "text", text: helpText }] };
        }

        const action = input.action as z.infer<typeof DashboardActionEnum>;
        const getDashId = () => (input.id || input.dashboardId) as string;

        switch (action) {
          case "listDashboards": {
            const page = await this.jiraClient.listDashboards({ filter: input.filter, startAt: input.startAt, maxResults: input.maxResults });
            return { content: [{ type: "text", text: `Found ${page.total ?? page.dashboards?.length ?? 0} dashboards.` }], data: page };
          }
          case "searchDashboards": {
            const page = await this.jiraClient.searchDashboards({ filter: input.filter, startAt: input.startAt, maxResults: input.maxResults });
            return { content: [{ type: "text", text: `Search returned ${page.total ?? page.dashboards?.length ?? 0} dashboards.` }], data: page };
          }
          case "getDashboard": {
            const id = getDashId();
            if (!id) throw new Error("getDashboard requires id");
            const dash = await this.jiraClient.getDashboard(id);
            return { content: [{ type: "text", text: `Dashboard: ${dash.name} (${dash.id})` }], data: dash };
          }
          case "createDashboard": {
            const payload = input.dashboardPayload ?? {
              name: input.name,
              description: input.description,
              sharePermissions: input.sharePermissions,
              editPermissions: input.editPermissions,
            };
            // Sanitize shares: remove public/global entries that Jira may reject
            if (Array.isArray((payload as any).sharePermissions)) {
              (payload as any).sharePermissions = (payload as any).sharePermissions.filter((p: any) => {
                const t = String(p?.type || '').toLowerCase();
                return t !== 'global' && t !== 'public';
              });
            }
            if (!payload.name) throw new Error("createDashboard requires name");
            const created = await this.jiraClient.createDashboard(payload);
            return { content: [{ type: "text", text: `Dashboard created: ${created.name} (${created.id})` }], data: created };
          }
          case "updateDashboard": {
            const id = getDashId();
            if (!id) throw new Error("updateDashboard requires id");
            const payload = input.dashboardPayload ?? {
              name: input.name,
              description: input.description,
              sharePermissions: input.sharePermissions,
              editPermissions: input.editPermissions,
            };
            if (Array.isArray((payload as any).sharePermissions)) {
              (payload as any).sharePermissions = (payload as any).sharePermissions.filter((p: any) => {
                const t = String(p?.type || '').toLowerCase();
                return t !== 'global' && t !== 'public';
              });
            }
            const updated = await this.jiraClient.updateDashboard(id, payload);
            return { content: [{ type: "text", text: `Dashboard updated: ${updated.name} (${updated.id})` }], data: updated };
          }
          case "deleteDashboard": {
            const id = getDashId();
            if (!id) throw new Error("deleteDashboard requires id");
            await this.jiraClient.deleteDashboard(id);
            return { content: [{ type: "text", text: `Dashboard ${id} deleted.` }] };
          }
          case "getAvailableGadgets": {
            const gadgets = await this.jiraClient.getAvailableGadgets();
            return { content: [{ type: "text", text: `Available gadgets: ${Array.isArray(gadgets) ? gadgets.length : "(see data)"}` }], data: gadgets };
          }
          case "getGadgets": {
            const id = getDashId();
            if (!id) throw new Error("getGadgets requires dashboardId");
            const list = await this.jiraClient.getGadgets(id);
            return { content: [{ type: "text", text: `Dashboard ${id} gadgets: ${Array.isArray(list) ? list.length : "(see data)"}` }], data: list };
          }
          case "addGadget": {
            const id = getDashId();
            if (!id) throw new Error("addGadget requires dashboardId");
            if (!input.gadgetPayload) throw new Error("addGadget requires gadgetPayload");
            const added = await this.jiraClient.addGadget(id, input.gadgetPayload);
            return { content: [{ type: "text", text: `Gadget added to ${id}.` }], data: added };
          }
          case "updateGadget": {
            const id = getDashId();
            if (!id) throw new Error("updateGadget requires dashboardId");
            if (!input.gadgetId) throw new Error("updateGadget requires gadgetId");
            if (!input.gadgetPayload) throw new Error("updateGadget requires gadgetPayload");
            const updated = await this.jiraClient.updateGadget(id, input.gadgetId, input.gadgetPayload);
            return { content: [{ type: "text", text: `Gadget ${input.gadgetId} updated on ${id}.` }], data: updated };
          }
          case "removeGadget": {
            const id = getDashId();
            if (!id) throw new Error("removeGadget requires dashboardId");
            if (!input.gadgetId) throw new Error("removeGadget requires gadgetId");
            await this.jiraClient.removeGadget(id, input.gadgetId);
            return { content: [{ type: "text", text: `Gadget ${input.gadgetId} removed from ${id}.` }] };
          }
          case "getDashboardItemPropertyKeys": {
            const id = getDashId();
            if (!id || !input.itemId) throw new Error("getDashboardItemPropertyKeys requires dashboardId and itemId");
            const keys = await this.jiraClient.getDashboardItemPropertyKeys(id, input.itemId);
            return { content: [{ type: "text", text: `Found ${keys.keys?.length ?? 0} property keys.` }], data: keys };
          }
          case "getDashboardItemProperty": {
            const id = getDashId();
            if (!id || !input.itemId || !input.propertyKey) throw new Error("getDashboardItemProperty requires dashboardId, itemId, propertyKey");
            const prop = await this.jiraClient.getDashboardItemProperty(id, input.itemId, input.propertyKey);
            return { content: [{ type: "text", text: `Property ${input.propertyKey} retrieved.` }], data: prop };
          }
          case "setDashboardItemProperty": {
            const id = getDashId();
            if (!id || !input.itemId || !input.propertyKey) throw new Error("setDashboardItemProperty requires dashboardId, itemId, propertyKey");
            if (!input.propertyValue) throw new Error("setDashboardItemProperty requires propertyValue");
            const result = await this.jiraClient.setDashboardItemProperty(id, input.itemId, input.propertyKey, input.propertyValue);
            return { content: [{ type: "text", text: `Property ${input.propertyKey} set.` }], data: result };
          }
          case "deleteDashboardItemProperty": {
            const id = getDashId();
            if (!id || !input.itemId || !input.propertyKey) throw new Error("deleteDashboardItemProperty requires dashboardId, itemId, propertyKey");
            await this.jiraClient.deleteDashboardItemProperty(id, input.itemId, input.propertyKey);
            return { content: [{ type: "text", text: `Property ${input.propertyKey} deleted.` }] };
          }
          case "copyDashboard": {
            const id = getDashId();
            if (!id) throw new Error("copyDashboard requires id");
            if (!input.dashboardPayload) throw new Error("copyDashboard requires dashboardPayload");
            const copy = await this.jiraClient.copyDashboard(id, input.dashboardPayload, input.extendAdminPermissions);
            return { content: [{ type: "text", text: `Dashboard ${id} copied to ${copy.id}.` }], data: copy };
          }
          default:
            throw new Error(`Unsupported dashboard action: ${action}`);
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
      "Start a Jira sprint. Some Jira instances require name, startDate, and endDate.",
      {
        sprintId: z.number().describe("ID of the sprint to start"),
        name: z.string().optional().describe("Sprint name (required on some instances)"),
        startDate: z
          .string()
          .optional()
          .describe("Start date in ISO format (e.g., 2025-10-26T00:00:00.000Z). Required on some instances."),
        endDate: z
          .string()
          .optional()
          .describe(
            "End date in ISO format (e.g., 2025-11-09T00:00:00.000Z). Required on some instances. Defaults to ~2 weeks after start if omitted.",
          ),
      },
      async ({ sprintId, name, startDate, endDate }) => {
        await this.jiraClient.startSprint(sprintId, { name, startDate, endDate });
        return {
          content: [{ text: `Sprint ${sprintId} started successfully.`, type: "text" }],
        };
      },
    );

    this.server.tool(
      "completeJiraSprint",
      "Complete a Jira sprint. Some Jira instances require name, startDate, and endDate.",
      {
        sprintId: z.number().describe("ID of the sprint to complete"),
        name: z.string().optional().describe("Sprint name (required on some instances)"),
        startDate: z
          .string()
          .optional()
          .describe("Start date in ISO format (e.g., 2025-10-26T00:00:00.000Z). Required on some instances."),
        endDate: z
          .string()
          .optional()
          .describe("End date in ISO format (e.g., 2025-11-09T00:00:00.000Z). Required on some instances."),
      },
      async ({ sprintId, name, startDate, endDate }) => {
        await this.jiraClient.completeSprint(sprintId, { name, startDate, endDate });
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
    "/sse": MyMCP.serveSSE("/sse") as any,
    "/mcp": MyMCP.serve("/mcp") as any,
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: "/token",
});
