import { Octokit } from "octokit";
import { z } from "zod";

/**
 * Lightweight copy of the stack-location helper from src/index.ts to keep this
 * module self-contained and avoid circular imports.
 */
function extractFirstAppLocation(error) {
  const stack = error && error.stack;
  if (typeof stack !== "string" || stack.length === 0) return undefined;
  try {
    const lines = stack.split("\n");
    const candidate = lines.find((l) => l.includes("/src/")) || lines[1] || lines[0];
    if (!candidate) return undefined;
    const match = candidate.match(/(\/[^\s)]+:\d+:\d+)/);
    return match && match[1];
  } catch {
    return undefined;
  }
}

/**
 * Register MCP tools on the current MyMCP instance.
 *
 * Call as `await registerTools.call(this)` from within MyMCP.init so that
 * `this.server` and `this.getJiraClient` are available.
 */
const ALLOWED_USERNAMES = new Set([
  "PortNumber53",
  // Add GitHub usernames of users who should have access to the image generation tool
  // For example: 'yourusername', 'coworkerusername'
]);

// Version identifier to track deployments
export const TOOLS_VERSION = "2026-02-05T23:26:00-08:00";

export async function registerTools() {
  const server = this.server;
  const getJiraClient = () => this.getJiraClient();

  console.log(`[TOOLS] Starting tool registration - Version: ${TOOLS_VERSION}`);
  const registeredTools = [];

  server.tool(
    "add",
    "Add two numbers the way only MCP can",
    { a: z.number(), b: z.number() },
    async ({ a, b }) => ({
      content: [{ text: String(a + b), type: "text" }],
    }),
  );
  registeredTools.push("add");

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
    "assignIssue",
    "unassignIssue",
  ]);
  const IssueActionSchema = z.union([z.literal("/help"), IssueActionEnum]);

  // Basic Jira project utilities
  server.tool("getProjects", "Get a list of all Jira projects", {}, async () => {
    const jiraClient = await getJiraClient();
    const projects = await jiraClient.getProjects();
    const projectsText = projects.map((project) => `${project.name} (${project.key})`).join("\n");
    return {
      content: [{ text: `Jira Projects:\n${projectsText}`, type: "text" }],
    };
  });
  registeredTools.push("getProjects");

  server.tool(
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
      categoryId: z.number().optional().describe("[OPTIONAL] Category ID - numeric ID of the project category to assign this project to."),
    },
    async (payload) => {
      try {
        const jiraClient = await getJiraClient();
        const newProject = await jiraClient.createProject(payload);
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
        const projectJson = JSON.stringify(projectData, null, 2);
        return {
          content: [
            { text: `Project created: ${newProject.name} (${newProject.key})`, type: "text" },
            { text: `MACHINE_PARSEABLE_DATA:\n${projectJson}`, type: "text" },
          ],
        };
      } catch (error) {
        const location = extractFirstAppLocation(error);
        let errorMessage = `Error creating project: ${error && error.message ? error.message : "Unknown error"}`;
        let errorType = "unknown";
        if (error && typeof error.message === "string") {
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
          errorType,
          message: (error && error.message) || "Unknown error",
          payload,
          location,
        };
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
  registeredTools.push("createJiraProject");

  // Jira user search helper
  server.tool(
    "getJiraUsers",
    "Find Jira users to get valid account IDs for project creation",
    {
      query: z
        .string()
        .describe(
          '[REQUIRED] Search query for users - can be a name, email, or username. Partial matches are supported (e.g., "john", "smith@example.com").',
        ),
      maxResults: z
        .number()
        .optional()
        .describe(
          "[OPTIONAL] Maximum number of results to return. Default is 50 if not specified. Use a smaller number for more focused results.",
        ),
    },
    async ({ query, maxResults }) => {
      try {
        const jiraClient = await getJiraClient();
        console.log("[mcp] getJiraUsers: received request", { query, maxResults });
        const response = await jiraClient.searchUsers(query, maxResults ?? 10);
        console.log("[mcp] getJiraUsers: Jira responded", {
          query,
          count: Array.isArray(response) ? response.length : null,
          type: typeof response,
        });

        if (!Array.isArray(response) || response.length === 0) {
          return {
            content: [{ text: `No users found matching "${query}"`, type: "text" }],
          };
        }

        const formattedUsers = response.map((user) => ({
          displayName: user.displayName,
          email: user.emailAddress || null,
          accountId: user.accountId,
          active: user.active,
        }));

        const usersText = formattedUsers
          .map(
            (user) =>
              `- ${user.displayName}\n  Account ID: ${user.accountId}\n  Email: ${user.email || "None"}\n  Active: ${user.active ? "Yes" : "No"
              }`,
          )
          .join("\n\n");

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
      } catch (error) {
        const location = extractFirstAppLocation(error);
        const errorMessage = `Error searching for users: ${(error && error.message) || "Unknown error"}`;
        const errorJson = JSON.stringify(
          {
            error: true,
            message: (error && error.message) || "Unknown error",
            query,
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
  registeredTools.push("getJiraUsers");

  // Detailed Jira project info
  server.tool(
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
        const jiraClient = await getJiraClient();
        const project = await jiraClient.getProject(projectIdOrKey, expand);

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
      } catch (error) {
        const location = extractFirstAppLocation(error);
        const message = (error && error.message) || "Unknown error";
        const errorJson = JSON.stringify(
          {
            success: false,
            message,
            projectIdOrKey,
            location,
          },
          null,
          2,
        );
        return {
          content: [
            {
              text: location ? `Error retrieving project: ${message} (at ${location})` : `Error retrieving project: ${message}`,
              type: "text",
            },
            { text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" },
          ],
        };
      }
    },
  );
  registeredTools.push("getJiraProject");

  // Jira issue types for a project
  server.tool(
    "getJiraProjectIssueTypes",
    "Get all available issue types for a Jira project, including subtask types",
    {
      projectIdOrKey: z.string().describe("[REQUIRED] ID or key of the project to retrieve issue types for"),
    },
    async ({ projectIdOrKey }) => {
      try {
        const jiraClient = await getJiraClient();
        const issueTypes = await jiraClient.getProjectIssueTypes(projectIdOrKey);

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

        const subtaskTypes = issueTypes.filter((type) => type && type.subtask === true);
        const standardTypes = issueTypes.filter((type) => type && type.subtask !== true);

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

        const responseJson = JSON.stringify(responseData, null, 2);

        return {
          content: [
            { text: result, type: "text" },
            { text: `MACHINE_PARSEABLE_DATA:\n${responseJson}`, type: "text" },
          ],
          data: responseData,
        };
      } catch (error) {
        const location = extractFirstAppLocation(error);
        const message = (error && error.message) || "Unknown error";
        const errorJson = JSON.stringify(
          {
            success: false,
            error: message,
            projectKey: projectIdOrKey,
            location,
          },
          null,
          2,
        );

        return {
          content: [
            {
              text: location ? `Error retrieving issue types: ${message} (at ${location})` : `Error retrieving issue types: ${message}`,
              type: "text",
            },
            { text: `MACHINE_PARSEABLE_DATA:\n${errorJson}`, type: "text" },
          ],
          data: {
            success: false,
            error: message,
            projectKey: projectIdOrKey,
          },
        };
      }
    },
  );
  registeredTools.push("getJiraProjectIssueTypes");

  // Unified Jira issue toolkit
  server.tool(
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
      orderBy: z.string().optional().describe("Order comments by 'created' or 'updated' (Jira may also accept createdDate/updatedDate)."),
      ids: z
        .array(z.union([z.string(), z.number()]))
        .optional()
        .describe("List of comment IDs for getCommentsByIds."),
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
        .array(
          z.object({
            key: z.string().describe("Key used when storing the comment property."),
            value: z
              .union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.unknown())])
              .optional()
              .describe("Optional value stored for the property key."),
          }),
        )
        .optional()
        .describe("Arbitrary properties to attach to the comment."),
      notifyUsers: z.boolean().optional().describe("Notify users when updating a comment."),
      overrideEditableFlag: z.boolean().optional().describe("Override editable flag when updating a comment (admin use)."),
      labels: z.array(z.string()).optional().describe("Labels for label actions."),
      filename: z.string().optional().describe("Filename when uploading an attachment."),
      fileBase64: z.string().optional().describe("Base64-encoded file contents for addAttachment."),
      contentType: z.string().optional().describe("Optional MIME type for uploaded attachment."),
      assignee: z.string().optional().describe("Assignee account ID for assignIssue/unassignIssue, or when creating/updating an issue. Use getJiraUsers to find valid account IDs."),
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
    async function handler(input) {
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
- assignIssue | unassignIssue: assign or unassign a user on an issue (use getJiraUsers to find account IDs)
- listIssueTypes | createIssueType | getIssueType | updateIssueType | deleteIssueType | getIssueTypeAlternatives: manage issue types (set projectKey on listIssueTypes to scope results).`;
        return { content: [{ text: helpText, type: "text" }] };
      }

      const jiraClientPromise = getJiraClient();
      const action = input.action;

      const ensureIssue = () => {
        if (!input.issueIdOrKey) throw new Error(`Action "${action}" requires issueIdOrKey.`);
        return input.issueIdOrKey;
      };

      const ensureLabels = () => {
        if (!input.labels || input.labels.length === 0) {
          throw new Error(`Action "${action}" requires one or more labels.`);
        }
        return input.labels;
      };

      const ensureCommentId = () => {
        if (!input.commentId) throw new Error(`Action "${action}" requires commentId.`);
        return input.commentId;
      };

      const normalizeIssueType = () => {
        if (!input.issueType) throw new Error("issueType is required when fields are not provided.");
        if (typeof input.issueType === "string") {
          if (/^\d+$/.test(input.issueType)) return { id: input.issueType };
          return { name: input.issueType };
        }
        if (!input.issueType.id && !input.issueType.name) {
          throw new Error("issueType object must include an id or name.");
        }
        return input.issueType;
      };

      const extractCommentText = () => {
        if (!input.commentBody) return undefined;
        if (typeof input.commentBody === "string") return input.commentBody;
        try {
          const doc = input.commentBody;
          const paragraphs = (doc && doc.content) || [];
          const text = paragraphs
            .flatMap((node) => (node && node.content) || [])
            .map((node) => (node && typeof node.text === "string" ? node.text : ""))
            .join(" ")
            .trim();
          return text || undefined;
        } catch {
          console.warn("Failed to extract text from comment body document.");
          return undefined;
        }
      };

      const extractFieldMapInput = () => {
        if (!input.fields || typeof input.fields === "string" || Array.isArray(input.fields)) {
          return undefined;
        }
        return input.fields;
      };

      const extractFieldSelection = () => {
        if (!input.fields) return undefined;
        if (typeof input.fields === "string" || Array.isArray(input.fields)) {
          return input.fields;
        }
        return undefined;
      };

      const jiraClient = await jiraClientPromise;

      switch (action) {
        case "createIssue": {
          let fields = extractFieldMapInput();
          if (!fields) {
            if (!input.projectKey) throw new Error("projectKey is required when fields are not provided.");
            if (!input.summary) throw new Error("summary is required when fields are not provided.");
            const issueType = normalizeIssueType();
            fields = {
              project: { key: input.projectKey },
              summary: input.summary,
              issuetype: issueType,
            };
            if (input.description !== undefined) fields.description = input.description;
            if (input.additionalFields) fields = { ...fields, ...input.additionalFields };
          }
          const created = await jiraClient.createIssue(fields);
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
          const issue = await jiraClient.getIssue(issueIdOrKey, {
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
          const descriptionText = jiraClient.documentToPlainText(issue.fields?.description) ?? "No description provided.";
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
          if (input.summary !== undefined) fields.summary = input.summary;
          if (input.description !== undefined) fields.description = input.description;
          if (input.assignee !== undefined) {
            fields.assignee = input.assignee === "" ? null : { accountId: input.assignee };
          }
          if (Object.keys(fields).length === 0) {
            throw new Error("updateIssue requires at least one field to modify.");
          }
          await jiraClient.updateIssue(issueIdOrKey, fields);
          return {
            content: [{ text: `Issue ${issueIdOrKey} updated successfully.`, type: "text" }],
            data: { success: true, issueIdOrKey, updatedFields: Object.keys(fields) },
          };
        }
        case "deleteIssue": {
          const issueIdOrKey = ensureIssue();
          await jiraClient.deleteIssue(issueIdOrKey);
          return {
            content: [{ text: `Issue ${issueIdOrKey} deleted.`, type: "text" }],
            data: { success: true, issueIdOrKey },
          };
        }
        case "searchIssues": {
          if (!input.jql) throw new Error("searchIssues requires a JQL query.");
          const results = await jiraClient.searchIssues(input.jql, {
            maxResults: input.maxResults,
            startAt: input.startAt,
            fields: extractFieldSelection(),
            expand: input.expand,
            properties: input.properties,
            fieldsByKeys: input.fieldsByKeys,
          });

          const issues = Array.isArray(results.issues) ? results.issues : [];
          const lines = issues.map((issue) => {
            if (!issue) return "[invalid issue result]";

            let key = typeof issue.key === "string" && issue.key.length > 0 ? issue.key : undefined;
            let summary =
              issue.fields && typeof issue.fields.summary === "string" && issue.fields.summary.length > 0
                ? issue.fields.summary
                : undefined;

            if (!key && typeof issue.id === "string" && issue.id.length > 0) {
              key = issue.id;
            }
            if (!summary && typeof (issue.summary || issue.title) === "string") {
              summary = issue.summary || issue.title;
            }

            if (!key && !summary) return "[invalid issue result]";
            return `${key ?? "?"}: ${summary ?? "<no summary>"}`;
          });

          return {
            content: [
              {
                text: `Found ${typeof results.total === "number" ? results.total : issues.length} issues. First page:\n${lines.join("\n")}`,
                type: "text",
              },
            ],
            data: { success: true, ...results },
          };
        }
        case "listComments": {
          const issueIdOrKey = ensureIssue();
          const comments = await jiraClient.listIssueComments(issueIdOrKey, {
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
          const commentsPage = await jiraClient.listIssueComments(issueIdOrKey, {
            startAt: input.startAt,
            maxResults: input.maxResults,
            orderBy: input.orderBy,
            expand: input.expand ?? "renderedBody",
          });
          const comments = commentsPage.comments || [];
          const plainTexts = comments.map((c) => jiraClient.documentToPlainText(c.body) || "");
          const result = {
            success: true,
            count: comments.length,
            ids: comments.map((c) => c.id),
            texts: plainTexts,
            comments,
            startAt: commentsPage.startAt ?? 0,
            maxResults: commentsPage.maxResults,
            total: commentsPage.total,
          };
          return {
            content: [{ text: `Found ${comments.length} comments (full)`, type: "text" }],
            data: result,
          };
        }
        case "addComment": {
          const issueIdOrKey = ensureIssue();
          if (!input.commentBody) throw new Error("addComment requires commentBody.");
          const comment = await jiraClient.addIssueComment(issueIdOrKey, input.commentBody, {
            visibility: input.visibility,
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
          if (!input.commentId) throw new Error("updateComment requires commentId.");
          if (!input.commentBody) throw new Error("updateComment requires commentBody.");
          const comment = await jiraClient.updateIssueComment(issueIdOrKey, input.commentId, input.commentBody, {
            visibility: input.visibility,
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
          if (!input.commentId) throw new Error("deleteComment requires commentId.");
          await jiraClient.deleteIssueComment(issueIdOrKey, input.commentId);
          return {
            content: [{ text: `Comment ${input.commentId} deleted.`, type: "text" }],
            data: { success: true, commentId: input.commentId },
          };
        }
        case "getComment": {
          const issueIdOrKey = ensureIssue();
          if (!input.commentId) throw new Error("getComment requires commentId.");
          const comment = await jiraClient.getIssueComment(issueIdOrKey, input.commentId);
          return {
            content: [{ text: JSON.stringify(comment, null, 2), type: "text" }],
            data: { success: true, comment },
          };
        }
        case "getCommentsByIds": {
          if (!input.ids || input.ids.length === 0) throw new Error("getCommentsByIds requires 'ids' array.");
          const page = await jiraClient.getIssueCommentsByIds(input.ids, input.expand);
          return {
            content: [{ text: `Fetched ${page.values.length} comments by IDs.`, type: "text" }],
            data: { success: true, ...page },
          };
        }
        case "getTransitions": {
          const issueIdOrKey = ensureIssue();
          const transitions = await jiraClient.getTransitions(issueIdOrKey);
          return {
            content: [
              {
                text: transitions.transitions.map((t) => `${t.id}: ${t.name} → ${t.to?.name}`).join("\n") || "No transitions available",
                type: "text",
              },
            ],
            data: { success: true, ...transitions },
          };
        }
        case "transitionIssue": {
          const issueIdOrKey = ensureIssue();
          if (!input.transitionId) throw new Error("transitionIssue requires transitionId.");
          const transitionComment = extractCommentText();
          await jiraClient.doTransition(issueIdOrKey, input.transitionId, transitionComment);
          return {
            content: [{ text: `Issue ${issueIdOrKey} transitioned using ${input.transitionId}.`, type: "text" }],
            data: { success: true, issueIdOrKey, transitionId: input.transitionId },
          };
        }
        case "getLabels": {
          const issueIdOrKey = ensureIssue();
          const labels = await jiraClient.getLabelsForIssue(issueIdOrKey);
          return {
            content: [{ text: labels.length ? labels.join(", ") : "No labels set", type: "text" }],
            data: { success: true, labels },
          };
        }
        case "addLabels": {
          const issueIdOrKey = ensureIssue();
          const labels = ensureLabels();
          await jiraClient.addLabels(issueIdOrKey, labels);
          return {
            content: [{ text: `Added labels to ${issueIdOrKey}.`, type: "text" }],
            data: { success: true, issueIdOrKey, labels },
          };
        }
        case "removeLabels": {
          const issueIdOrKey = ensureIssue();
          const labels = ensureLabels();
          await jiraClient.removeLabels(issueIdOrKey, labels);
          return {
            content: [{ text: `Removed labels from ${issueIdOrKey}.`, type: "text" }],
            data: { success: true, issueIdOrKey, labels },
          };
        }
        case "setLabels": {
          const issueIdOrKey = ensureIssue();
          const labels = input.labels || [];
          await jiraClient.setLabels(issueIdOrKey, labels);
          return {
            content: [{ text: `Labels on ${issueIdOrKey} set to [${labels.join(", ")}].`, type: "text" }],
            data: { success: true, issueIdOrKey, labels },
          };
        }
        case "listAttachments": {
          const issueIdOrKey = ensureIssue();
          const attachments = await jiraClient.getIssueAttachments(issueIdOrKey);
          return {
            content: [{ text: `Found ${attachments.length} attachments.`, type: "text" }],
            data: { success: true, attachments },
          };
        }
        case "addAttachment": {
          const issueIdOrKey = ensureIssue();
          if (!input.filename) throw new Error("addAttachment requires filename.");
          if (!input.fileBase64) {
            throw new Error("addAttachment requires fileBase64. Provide raw base64 without the data URI prefix.");
          }
          const base64 = input.fileBase64.includes(",") ? input.fileBase64.split(",").pop() : input.fileBase64;
          const attachments = await jiraClient.addIssueAttachment(issueIdOrKey, input.filename, base64, input.contentType);
          return {
            content: [{ text: `Uploaded attachment(s) to ${issueIdOrKey}.`, type: "text" }],
            data: { success: true, attachments },
          };
        }
        case "deleteAttachment": {
          if (!input.attachmentId) throw new Error("deleteAttachment requires attachmentId.");
          await jiraClient.deleteIssueAttachment(input.attachmentId);
          return {
            content: [{ text: `Attachment ${input.attachmentId} deleted.`, type: "text" }],
            data: { success: true, attachmentId: input.attachmentId },
          };
        }
        case "listPriorities": {
          const priorities = await jiraClient.listPriorities();
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
          await jiraClient.updateIssue(issueIdOrKey, { priority: priorityField });
          return {
            content: [{ text: `Priority updated for ${issueIdOrKey}.`, type: "text" }],
            data: { success: true, issueIdOrKey, priority: priorityField },
          };
        }
        case "listIssueTypes": {
          if (input.projectKey) {
            const issueTypes = await jiraClient.getProjectIssueTypes(input.projectKey);
            const standardTypes = issueTypes.filter((type) => type && type.subtask !== true);
            const subtaskTypes = issueTypes.filter((type) => type && type.subtask === true);
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
          const issueTypes = await jiraClient.getAllIssueTypes();
          return {
            content: [{ text: `Found ${issueTypes.length} issue types.`, type: "text" }],
            data: { success: true, issueTypes },
          };
        }
        case "createIssueType": {
          if (!input.issueTypePayload) throw new Error("createIssueType requires issueTypePayload.");
          if (!input.issueTypePayload.name) throw new Error("issueTypePayload.name is required.");
          const created = await jiraClient.createIssueType(input.issueTypePayload);
          return {
            content: [{ text: `Issue type created: ${created.name} (${created.id})`, type: "text" }],
            data: { success: true, issueType: created },
          };
        }
        case "getIssueType": {
          if (!input.issueTypeId) throw new Error("getIssueType requires issueTypeId.");
          const issueType = await jiraClient.getIssueType(input.issueTypeId);
          return {
            content: [{ text: `Issue type ${issueType.name}`, type: "text" }],
            data: { success: true, issueType },
          };
        }
        case "updateIssueType": {
          if (!input.issueTypeId) throw new Error("updateIssueType requires issueTypeId.");
          if (!input.issueTypePayload || Object.keys(input.issueTypePayload).length === 0) {
            throw new Error("issueTypePayload must include fields to update.");
          }
          const updated = await jiraClient.updateIssueType(input.issueTypeId, input.issueTypePayload);
          return {
            content: [{ text: `Issue type updated: ${updated.name}`, type: "text" }],
            data: { success: true, issueType: updated },
          };
        }
        case "deleteIssueType": {
          if (!input.issueTypeId) throw new Error("deleteIssueType requires issueTypeId.");
          await jiraClient.deleteIssueType(input.issueTypeId, input.alternativeIssueTypeId);
          return {
            content: [{ text: `Issue type ${input.issueTypeId} deleted.`, type: "text" }],
            data: { success: true, issueTypeId: input.issueTypeId },
          };
        }
        case "getIssueTypeAlternatives": {
          if (!input.issueTypeId) throw new Error("getIssueTypeAlternatives requires issueTypeId.");
          const alternatives = await jiraClient.getAlternativeIssueTypes(input.issueTypeId);
          return {
            content: [{ text: `Found ${alternatives.length} alternative issue types.`, type: "text" }],
            data: { success: true, alternatives },
          };
        }
        case "assignIssue": {
          const issueIdOrKey = ensureIssue();
          if (!input.assignee) throw new Error("assignIssue requires the 'assignee' parameter (an accountId). Use getJiraUsers to find valid account IDs.");
          await jiraClient.updateIssue(issueIdOrKey, { assignee: { accountId: input.assignee } });
          return {
            content: [{ text: `Issue ${issueIdOrKey} assigned to ${input.assignee}.`, type: "text" }],
            data: { success: true, issueIdOrKey, assignee: input.assignee },
          };
        }
        case "unassignIssue": {
          const issueIdOrKey = ensureIssue();
          await jiraClient.updateIssue(issueIdOrKey, { assignee: null });
          return {
            content: [{ text: `Issue ${issueIdOrKey} unassigned.`, type: "text" }],
            data: { success: true, issueIdOrKey, assignee: null },
          };
        }
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    },
  );
  registeredTools.push("jiraIssueToolkit");

  server.tool(
    "createJiraSprint",
    "Create a new Jira sprint",
    {
      name: z
        .string()
        .describe("[REQUIRED] Sprint name - descriptive name for the sprint (e.g., 'Sprint 1', 'June Release')."),
      originBoardId: z
        .number()
        .describe("[REQUIRED] Board ID to create the sprint in - numeric ID of the Scrum board (e.g., 123). Get this from your board URL."),
      startDate: z
        .string()
        .optional()
        .describe("[OPTIONAL] Start date in ISO format (e.g., '2025-06-30T08:00:00.000Z'). If not provided, sprint will be created in future state."),
      endDate: z
        .string()
        .optional()
        .describe("[OPTIONAL] End date in ISO format (e.g., '2025-07-14T17:00:00.000Z'). Should be after startDate."),
      goal: z.string().optional().describe("[OPTIONAL] Sprint goal - brief description of what the team aims to achieve in this sprint."),
    },
    async ({ name, startDate, endDate, originBoardId, goal }) => {
      const jiraClient = await getJiraClient();
      const payload = { name, originBoardId };
      if (startDate) payload.startDate = startDate;
      if (endDate) payload.endDate = endDate;
      if (goal) payload.goal = goal;
      const newSprint = await jiraClient.createSprint(payload);
      return {
        content: [{ text: `Sprint created: ${newSprint.id} - ${newSprint.name}`, type: "text" }],
      };
    },
  );
  registeredTools.push("createJiraSprint");

  server.tool(
    "startJiraSprint",
    "Start a Jira sprint. Some Jira instances require name, startDate, and endDate.",
    {
      sprintId: z.number().describe("ID of the sprint to start"),
      name: z.string().optional().describe("Sprint name (required on some instances)"),
      startDate: z.string().optional().describe("Start date in ISO format (e.g., 2025-10-26T00:00:00.000Z). Required on some instances."),
      endDate: z
        .string()
        .optional()
        .describe("End date in ISO format (e.g., 2025-11-09T00:00:00.000Z). Required on some instances. Defaults to ~2 weeks after start if omitted."),
    },
    async ({ sprintId, name, startDate, endDate }) => {
      const jiraClient = await getJiraClient();
      await jiraClient.startSprint(sprintId, { name, startDate, endDate });
      return {
        content: [{ text: `Sprint ${sprintId} started successfully.`, type: "text" }],
      };
    },
  );
  registeredTools.push("startJiraSprint");

  server.tool(
    "completeJiraSprint",
    "Complete a Jira sprint. The sprint must be in 'active' state — future sprints must be started first, and closed sprints cannot be reopened. Use getJiraSprintsForBoard to find sprint IDs, and getJiraBoardsForProject to find board IDs for a project.",
    {
      sprintId: z.number().describe("ID of the sprint to complete. Use getJiraSprintsForBoard to find sprint IDs for a board."),
      name: z.string().optional().describe("Sprint name (required on some instances)"),
      startDate: z.string().optional().describe("Start date in ISO format (e.g., 2025-10-26T00:00:00.000Z). Required on some instances."),
      endDate: z.string().optional().describe("End date in ISO format (e.g., 2025-11-09T00:00:00.000Z). Required on some instances."),
    },
    async ({ sprintId, name, startDate, endDate }) => {
      try {
        const jiraClient = await getJiraClient();
        await jiraClient.completeSprint(sprintId, { name, startDate, endDate });
        return {
          content: [{ text: `Sprint ${sprintId} completed successfully.`, type: "text" }],
        };
      } catch (error) {
        const msg = error?.message || String(error);
        if (msg.includes("already closed")) {
          return { content: [{ text: `Error: ${msg}`, type: "text" }], isError: true };
        }
        if (msg.includes("future")) {
          return { content: [{ text: `Error: ${msg}`, type: "text" }], isError: true };
        }
        if (msg.includes("404")) {
          return { content: [{ text: `Error: Sprint ${sprintId} not found. Use getJiraSprintsForBoard to list valid sprint IDs.`, type: "text" }], isError: true };
        }
        if (msg.includes("403") || msg.includes("permission")) {
          return { content: [{ text: `Error: Permission denied. You need 'Manage Sprints' permission in the project to complete a sprint.`, type: "text" }], isError: true };
        }
        return { content: [{ text: `Error completing sprint ${sprintId}: ${msg}`, type: "text" }], isError: true };
      }
    },
  );
  registeredTools.push("completeJiraSprint");
  console.log("[TOOLS] Registered completeJiraSprint tool");

  server.tool(
    "getJiraSprint",
    "Get details of a Jira sprint",
    {
      sprintId: z.number().describe("ID of the sprint to retrieve"),
    },
    async ({ sprintId }) => {
      const jiraClient = await getJiraClient();
      const sprint = await jiraClient.getSprint(sprintId);
      return {
        content: [{ text: `Sprint ${sprint.name} (ID: ${sprint.id}, State: ${sprint.state})`, type: "text" }],
      };
    },
  );
  registeredTools.push("getJiraSprint");

  server.tool(
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
      const jiraClient = await getJiraClient();
      const updatedSprint = await jiraClient.updateSprint(sprintId, { name, startDate, endDate, state, goal });
      return {
        content: [{ text: `Sprint updated: ${updatedSprint.name} (ID: ${updatedSprint.id})`, type: "text" }],
      };
    },
  );
  registeredTools.push("updateJiraSprint");

  server.tool(
    "deleteJiraSprint",
    "Delete a Jira sprint",
    {
      sprintId: z.number().describe("ID of the sprint to delete"),
    },
    async ({ sprintId }) => {
      const jiraClient = await getJiraClient();
      await jiraClient.deleteSprint(sprintId);
      return {
        content: [{ text: `Sprint ${sprintId} deleted successfully.`, type: "text" }],
      };
    },
  );
  registeredTools.push("deleteJiraSprint");

  server.tool(
    "getJiraBoardsForProject",
    "Get all Agile boards for a given Jira project. Use this to find the board ID needed for sprint operations like getJiraSprintsForBoard or completeJiraSprint.",
    {
      projectKeyOrId: z.string().describe("Project key (e.g., 'MJT') or numeric project ID to find boards for."),
    },
    async ({ projectKeyOrId }) => {
      const jiraClient = await getJiraClient();
      const boards = await jiraClient.getBoardsForProject(projectKeyOrId);
      if (boards.length === 0) {
        return {
          content: [{ text: `No boards found for project ${projectKeyOrId}. The project may not have an Agile board configured.`, type: "text" }],
        };
      }
      const boardsText = boards
        .map((board) => `${board.name} (ID: ${board.id}, Type: ${board.type})`)
        .join("\n");
      return {
        content: [{ text: `Boards for project ${projectKeyOrId}:\n${boardsText}`, type: "text" }],
      };
    },
  );
  registeredTools.push("getJiraBoardsForProject");

  server.tool(
    "getJiraSprintsForBoard",
    "Get all sprints for a given Jira board",
    {
      boardId: z.number().describe("ID of the Jira board"),
    },
    async ({ boardId }) => {
      const jiraClient = await getJiraClient();
      const sprints = await jiraClient.getSprintsForBoard(boardId);
      const sprintsText = sprints.map((sprint) => `${sprint.name} (ID: ${sprint.id}, State: ${sprint.state})`).join("\n");
      return {
        content: [{ text: `Sprints for board ${boardId}:\n${sprintsText}`, type: "text" }],
      };
    },
  );
  registeredTools.push("getJiraSprintsForBoard");

  server.tool(
    "getJiraIssuesForSprint",
    "Get all issues for a given Jira sprint",
    {
      sprintId: z.number().describe("ID of the Jira sprint"),
    },
    async ({ sprintId }) => {
      const jiraClient = await getJiraClient();
      const issues = await jiraClient.getIssuesForSprint(sprintId);
      const issuesText = issues.map((issue) => `${issue.key}: ${issue.fields.summary}`).join("\n");
      return {
        content: [{ text: `Issues for sprint ${sprintId}:\n${issuesText}`, type: "text" }],
      };
    },
  );
  registeredTools.push("getJiraIssuesForSprint");

  server.tool(
    "moveJiraIssuesToSprint",
    "Move issues to a Jira sprint",
    {
      sprintId: z.number().describe("ID of the target sprint"),
      issueIdsOrKeys: z.array(z.string()).describe("Array of issue IDs or keys to move"),
    },
    async ({ sprintId, issueIdsOrKeys }) => {
      const jiraClient = await getJiraClient();
      await jiraClient.moveIssuesToSprint(sprintId, issueIdsOrKeys);
      return {
        content: [{ text: `Moved issues ${issueIdsOrKeys.join(", ")} to sprint ${sprintId}.`, type: "text" }],
      };
    },
  );
  registeredTools.push("moveJiraIssuesToSprint");

  server.tool(
    "moveJiraIssuesToBacklog",
    "Move issues to the Jira backlog",
    {
      boardId: z.number().describe("ID of the Jira board"),
      issueIdsOrKeys: z.array(z.string()).describe("Array of issue IDs or keys to move"),
    },
    async ({ boardId, issueIdsOrKeys }) => {
      const jiraClient = await getJiraClient();
      await jiraClient.moveIssuesToBacklog(boardId, issueIdsOrKeys);
      return {
        content: [{ text: `Moved issues ${issueIdsOrKeys.join(", ")} to backlog for board ${boardId}.`, type: "text" }],
      };
    },
  );
  registeredTools.push("moveJiraIssuesToBacklog");

  server.tool(
    "getJiraUser",
    "Get details of a Jira user",
    {
      accountId: z.string().describe("Account ID of the user to retrieve"),
    },
    async ({ accountId }) => {
      const jiraClient = await getJiraClient();
      const user = await jiraClient.getUser(accountId);
      return {
        content: [
          { text: `User: ${user.displayName} (Account ID: ${user.accountId}, Email: ${user.emailAddress})`, type: "text" },
        ],
      };
    },
  );
  registeredTools.push("getJiraUser");

  server.tool(
    "createJiraUser",
    "Create a new Jira user",
    {
      emailAddress: z.string().describe("Email address of the new user"),
      password: z.string().describe("Password for the new user"),
      displayName: z.string().describe("Display name of the new user"),
    },
    async ({ emailAddress, password, displayName }) => {
      const jiraClient = await getJiraClient();
      const newUser = await jiraClient.createUser({ emailAddress, password, displayName });
      return {
        content: [{ text: `User created: ${newUser.displayName} (Account ID: ${newUser.accountId})`, type: "text" }],
      };
    },
  );
  registeredTools.push("createJiraUser");

  server.tool(
    "deleteJiraUser",
    "Delete a Jira user",
    {
      accountId: z.string().describe("Account ID of the user to delete"),
    },
    async ({ accountId }) => {
      const jiraClient = await getJiraClient();
      await jiraClient.deleteUser(accountId);
      return {
        content: [{ text: `User ${accountId} deleted successfully.`, type: "text" }],
      };
    },
  );
  registeredTools.push("deleteJiraUser");

  server.tool(
    "userInfoOctokit",
    "Get user info from GitHub, via Octokit",
    {},
    async () => {
      const octokit = new Octokit({ auth: this.props?.accessToken });
      const user = await octokit.rest.users.getAuthenticated();
      return {
        content: [{ text: JSON.stringify(user), type: "text" }],
      };
    },
  );
  registeredTools.push("userInfoOctokit");

  const login = this.props && this.props.login;
  if (typeof login === "string" && ALLOWED_USERNAMES.has(login)) {
    server.tool(
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
          num_steps: steps,
        });
        return {
          content: [{ data: response.image, mimeType: "image/jpeg", type: "image" }],
        };
      },
    );
    registeredTools.push("generateImage");
    console.log("[TOOLS] Registered generateImage tool (user-specific)");
  }

  // Backend job queue integration
  server.tool(
    "enqueueBackendJob",
    "Enqueue an asynchronous job on the Go backend. Jobs are processed by the backend worker with retry logic and priority scheduling. Use this to trigger long-running tasks like data migrations, bulk operations, or scheduled maintenance.",
    {
      jobType: z.string().describe("The type of job to enqueue (e.g., 'stripe_migration', 'data_export', 'cleanup')."),
      payload: z.record(z.unknown()).optional().describe("JSON payload for the job handler."),
      priority: z.enum(["low", "normal", "high", "critical"]).optional().default("normal").describe("Job priority level."),
      maxAttempts: z.number().optional().default(3).describe("Maximum number of retry attempts."),
    },
    async ({ jobType, payload, priority, maxAttempts }) => {
      try {
        const backendBase = this.env.BACKEND_BASE_URL;
        if (!backendBase) {
          return { content: [{ text: "Error: BACKEND_BASE_URL is not configured.", type: "text" }], isError: true };
        }

        const url = new URL("/api/jobs", backendBase);
        const response = await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_type: jobType,
            payload: payload || {},
            priority: priority || "normal",
            max_attempts: maxAttempts || 3,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return { content: [{ text: `Error enqueuing job: ${response.status} - ${errorText}`, type: "text" }], isError: true };
        }

        const result = await response.json();
        return {
          content: [{ text: `Job enqueued successfully. ID: ${result.id}, Status: ${result.status}`, type: "text" }],
        };
      } catch (error) {
        const msg = error?.message || String(error);
        return { content: [{ text: `Error enqueuing job: ${msg}`, type: "text" }], isError: true };
      }
    },
  );
  registeredTools.push("enqueueBackendJob");

  server.tool(
    "getBackendJobStatus",
    "Check the status of an asynchronous job on the Go backend.",
    {
      jobId: z.number().describe("The ID of the job to check."),
    },
    async ({ jobId }) => {
      try {
        const backendBase = this.env.BACKEND_BASE_URL;
        if (!backendBase) {
          return { content: [{ text: "Error: BACKEND_BASE_URL is not configured.", type: "text" }], isError: true };
        }

        const url = new URL("/api/jobs", backendBase);
        url.searchParams.set("id", String(jobId));
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          const errorText = await response.text();
          return { content: [{ text: `Error fetching job: ${response.status} - ${errorText}`, type: "text" }], isError: true };
        }

        const job = await response.json();
        const lines = [
          `Job #${job.id} (${job.job_type})`,
          `Status: ${job.status}`,
          `Priority: ${job.priority}`,
          `Attempts: ${job.attempts}/${job.max_attempts}`,
        ];
        if (job.last_error) lines.push(`Last Error: ${job.last_error}`);
        if (job.completed_at) lines.push(`Completed: ${job.completed_at}`);

        return { content: [{ text: lines.join("\n"), type: "text" }] };
      } catch (error) {
        const msg = error?.message || String(error);
        return { content: [{ text: `Error fetching job status: ${msg}`, type: "text" }], isError: true };
      }
    },
  );
  registeredTools.push("getBackendJobStatus");

  server.tool(
    "getBackendJobStats",
    "Get statistics about the backend job queue (pending, processing, completed, failed counts).",
    {},
    async () => {
      try {
        const backendBase = this.env.BACKEND_BASE_URL;
        if (!backendBase) {
          return { content: [{ text: "Error: BACKEND_BASE_URL is not configured.", type: "text" }], isError: true };
        }

        const url = new URL("/api/jobs/stats", backendBase);
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          const errorText = await response.text();
          return { content: [{ text: `Error fetching stats: ${response.status} - ${errorText}`, type: "text" }], isError: true };
        }

        const stats = await response.json();
        const text = [
          `Job Queue Statistics:`,
          `  Pending: ${stats.pending}`,
          `  Processing: ${stats.processing}`,
          `  Completed: ${stats.completed}`,
          `  Failed: ${stats.failed}`,
          `  Cancelled: ${stats.cancelled}`,
          `  Total: ${stats.total}`,
        ].join("\n");

        return { content: [{ text, type: "text" }] };
      } catch (error) {
        const msg = error?.message || String(error);
        return { content: [{ text: `Error fetching job stats: ${msg}`, type: "text" }], isError: true };
      }
    },
  );
  registeredTools.push("getBackendJobStats");

  // --- Helper: fetch an integration token from the backend by mcp_secret ---
  const fetchIntegrationToken = async (provider) => {
    const backendBase = this.env.BACKEND_BASE_URL;
    if (!backendBase) throw new Error("BACKEND_BASE_URL is not configured.");

    const props = this.props ?? {};
    const mcpSecret = props.mcpSecret;
    if (!mcpSecret) throw new Error("No MCP secret available to resolve integration token.");

    const url = new URL("/api/integrations/tokens/tenant", backendBase);
    url.searchParams.set("mcp_secret", mcpSecret);
    url.searchParams.set("provider", provider);

    const resp = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to fetch ${provider} token: ${resp.status} ${text}`);
    }
    return resp.json();
  };

  // --- Google Docs MCP Tools ---
  server.tool(
    "listGoogleDocs",
    "List Google Docs accessible to the connected Google account. Requires the Google Docs integration to be connected in the Integrations page.",
    {
      query: z.string().optional().describe("Optional search query to filter documents by name."),
      pageSize: z.number().optional().describe("Number of documents to return (default 20, max 100)."),
    },
    async ({ query, pageSize }) => {
      const token = await fetchIntegrationToken("google_docs");
      if (!token) {
        return {
          content: [{ text: "Google Docs integration is not connected. Please connect it in the Integrations page.", type: "text" }],
          isError: true,
        };
      }

      const params = new URLSearchParams();
      const mimeFilter = "mimeType='application/vnd.google-apps.document'";
      const nameFilter = query ? ` and name contains '${query.replace(/'/g, "\\'")}'` : "";
      params.set("q", `${mimeFilter}${nameFilter}`);
      params.set("fields", "files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken");
      params.set("pageSize", String(pageSize ?? 20));
      params.set("orderBy", "modifiedTime desc");

      const resp = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return { content: [{ text: `Google Drive API error: ${resp.status} ${errText}`, type: "text" }], isError: true };
      }

      const data = await resp.json();
      const files = data.files || [];
      if (files.length === 0) {
        return { content: [{ text: "No Google Docs found.", type: "text" }] };
      }

      const lines = files.map((f) => `- ${f.name} (${f.id}) — modified ${f.modifiedTime}`);
      return {
        content: [{ text: `Found ${files.length} document(s):\n${lines.join("\n")}`, type: "text" }],
        data: { success: true, documents: files },
      };
    },
  );
  registeredTools.push("listGoogleDocs");

  server.tool(
    "getGoogleDoc",
    "Get the plain text content of a Google Doc by its document ID. Requires the Google Docs integration to be connected.",
    {
      documentId: z.string().describe("The Google Docs document ID."),
    },
    async ({ documentId }) => {
      const token = await fetchIntegrationToken("google_docs");
      if (!token) {
        return {
          content: [{ text: "Google Docs integration is not connected. Please connect it in the Integrations page.", type: "text" }],
          isError: true,
        };
      }

      const resp = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return { content: [{ text: `Google Docs API error: ${resp.status} ${errText}`, type: "text" }], isError: true };
      }

      const doc = await resp.json();

      // Extract plain text from the document body
      const parts = [];
      const walk = (elements) => {
        if (!elements) return;
        for (const el of elements) {
          if (el.paragraph?.elements) {
            for (const pe of el.paragraph.elements) {
              if (pe.textRun?.content) parts.push(pe.textRun.content);
            }
          }
          if (el.table?.tableRows) {
            for (const row of el.table.tableRows) {
              for (const cell of row.tableCells || []) {
                walk(cell.content);
              }
            }
          }
        }
      };
      walk(doc.body?.content);

      const text = parts.join("");
      return {
        content: [{ text: `# ${doc.title}\n\n${text}`, type: "text" }],
        data: { success: true, documentId: doc.documentId, title: doc.title },
      };
    },
  );
  registeredTools.push("getGoogleDoc");

  server.tool(
    "appendToGoogleDoc",
    "Append text to the end of a Google Doc. Requires the Google Docs integration to be connected.",
    {
      documentId: z.string().describe("The Google Docs document ID."),
      text: z.string().describe("The text to append to the document."),
    },
    async ({ documentId, text }) => {
      const token = await fetchIntegrationToken("google_docs");
      if (!token) {
        return {
          content: [{ text: "Google Docs integration is not connected. Please connect it in the Integrations page.", type: "text" }],
          isError: true,
        };
      }

      // Get the document to find the end index
      const docResp = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      });
      if (!docResp.ok) {
        const errText = await docResp.text();
        return { content: [{ text: `Failed to read document: ${docResp.status} ${errText}`, type: "text" }], isError: true };
      }

      const doc = await docResp.json();
      const body = doc.body;
      if (!body?.content?.length) {
        return { content: [{ text: "Document body is empty or inaccessible.", type: "text" }], isError: true };
      }

      const lastElement = body.content[body.content.length - 1];
      const endIndex = Math.max((lastElement.endIndex ?? 1) - 1, 1);

      const updateResp = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [{ insertText: { location: { index: endIndex }, text } }],
        }),
      });

      if (!updateResp.ok) {
        const errText = await updateResp.text();
        return { content: [{ text: `Failed to append text: ${updateResp.status} ${errText}`, type: "text" }], isError: true };
      }

      return {
        content: [{ text: `Successfully appended ${text.length} characters to document ${documentId}.`, type: "text" }],
        data: { success: true, documentId, charsAppended: text.length },
      };
    },
  );
  registeredTools.push("appendToGoogleDoc");

  server.tool(
    "replaceInGoogleDoc",
    "Replace all occurrences of a substring in a Google Doc. Requires the Google Docs integration to be connected.",
    {
      documentId: z.string().describe("The Google Docs document ID."),
      searchText: z.string().describe("The text to search for."),
      replaceText: z.string().describe("The replacement text."),
    },
    async ({ documentId, searchText, replaceText }) => {
      const token = await fetchIntegrationToken("google_docs");
      if (!token) {
        return {
          content: [{ text: "Google Docs integration is not connected. Please connect it in the Integrations page.", type: "text" }],
          isError: true,
        };
      }

      const resp = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [{
            replaceAllText: {
              containsText: { text: searchText, matchCase: true },
              replaceText,
            },
          }],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return { content: [{ text: `Failed to replace text: ${resp.status} ${errText}`, type: "text" }], isError: true };
      }

      const result = await resp.json();
      const changed = result.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
      return {
        content: [{ text: `Replaced ${changed} occurrence(s) of "${searchText}" with "${replaceText}" in document ${documentId}.`, type: "text" }],
        data: { success: true, documentId, occurrencesChanged: changed },
      };
    },
  );
  registeredTools.push("replaceInGoogleDoc");

  // --- Slack MCP Tools ---
  server.tool(
    "sendSlackMessage",
    "Send a message to a Slack channel. Requires the Slack integration to be connected (INTEGRATION_SLACK_ENABLED + SLACK_BOT_TOKEN).",
    {
      channel: z.string().describe("Slack channel ID or name (e.g. '#general' or 'C01234ABCDE')."),
      text: z.string().describe("The message text to send."),
      threadTs: z.string().optional().describe("Optional thread timestamp to reply in a thread."),
    },
    async ({ channel, text, threadTs }) => {
      // For Slack, we use the bot token from env (set by admin), not per-user OAuth
      const botToken = this.env.SLACK_BOT_TOKEN;
      if (!botToken) {
        return {
          content: [{ text: "Slack integration is not configured. Set SLACK_BOT_TOKEN in the environment.", type: "text" }],
          isError: true,
        };
      }

      const payload = { channel, text };
      if (threadTs) payload.thread_ts = threadTs;

      const resp = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      if (!data.ok) {
        return { content: [{ text: `Slack API error: ${data.error}`, type: "text" }], isError: true };
      }

      return {
        content: [{ text: `Message sent to ${channel} (ts: ${data.ts}).`, type: "text" }],
        data: { success: true, channel: data.channel, ts: data.ts },
      };
    },
  );
  registeredTools.push("sendSlackMessage");

  server.tool(
    "listSlackChannels",
    "List Slack channels the bot has access to. Requires the Slack integration to be configured.",
    {
      limit: z.number().optional().describe("Max channels to return (default 100)."),
    },
    async ({ limit }) => {
      const botToken = this.env.SLACK_BOT_TOKEN;
      if (!botToken) {
        return {
          content: [{ text: "Slack integration is not configured. Set SLACK_BOT_TOKEN in the environment.", type: "text" }],
          isError: true,
        };
      }

      const resp = await fetch("https://slack.com/api/conversations.list", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          types: "public_channel,private_channel",
          limit: limit ?? 100,
          exclude_archived: true,
        }),
      });

      const data = await resp.json();
      if (!data.ok) {
        return { content: [{ text: `Slack API error: ${data.error}`, type: "text" }], isError: true };
      }

      const channels = data.channels || [];
      if (channels.length === 0) {
        return { content: [{ text: "No channels found.", type: "text" }] };
      }

      const lines = channels.map((ch) => `- #${ch.name} (${ch.id})${ch.is_member ? " [member]" : ""}`);
      return {
        content: [{ text: `Found ${channels.length} channel(s):\n${lines.join("\n")}`, type: "text" }],
        data: { success: true, channels },
      };
    },
  );
  registeredTools.push("listSlackChannels");

  console.log(`[TOOLS] Tool registration complete - Version: ${TOOLS_VERSION}`);
  console.log(`[TOOLS] Total tools registered: ${registeredTools.length}`);
  console.log(`[TOOLS] Registered tools: ${registeredTools.join(", ")}`);
}

