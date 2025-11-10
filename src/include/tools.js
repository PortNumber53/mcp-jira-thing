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
export async function registerTools() {
  const server = this.server;
  const getJiraClient = () => this.getJiraClient();

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

  // Basic Jira project utilities
  server.tool("getProjects", "Get a list of all Jira projects", {}, async () => {
    const jiraClient = await getJiraClient();
    const projects = await jiraClient.getProjects();
    const projectsText = projects.map((project) => `${project.name} (${project.key})`).join("\n");
    return {
      content: [{ text: `Jira Projects:\n${projectsText}`, type: "text" }],
    };
  });

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
              `- ${user.displayName}\n  Account ID: ${user.accountId}\n  Email: ${user.email || "None"}\n  Active: ${
                user.active ? "Yes" : "No"
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
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    },
  );
}
