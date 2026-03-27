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

  // --- Response normalization helpers ---
  // Strip avatarUrls from any object tree (AI agents don't need visual data)
  const stripAvatarUrls = (obj) => {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(stripAvatarUrls);
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "avatarUrls") continue;
      if (key === "self" && typeof value === "string" && value.includes("/rest/api/")) continue;
      result[key] = stripAvatarUrls(value);
    }
    return result;
  };

  // Extract a compact user reference { accountId, displayName, email }
  const normalizeUser = (user) => {
    if (!user) return null;
    return {
      accountId: user.accountId,
      displayName: user.displayName,
      email: user.emailAddress || undefined,
    };
  };

  // Deduplicate users from an issue list and replace inline user objects with accountId refs
  const normalizeResponse = (data) => {
    const cleaned = stripAvatarUrls(data);
    if (!cleaned) return cleaned;

    // If it has an issues array, deduplicate users
    if (Array.isArray(cleaned.issues)) {
      const usersMap = new Map();
      const collectUser = (user) => {
        if (user && user.accountId && !usersMap.has(user.accountId)) {
          usersMap.set(user.accountId, normalizeUser(user));
        }
      };
      const replaceUser = (user) => {
        if (!user || !user.accountId) return user;
        collectUser(user);
        return user.accountId;
      };

      for (const issue of cleaned.issues) {
        if (!issue.fields) continue;
        if (issue.fields.assignee) issue.fields.assignee = replaceUser(issue.fields.assignee);
        if (issue.fields.reporter) issue.fields.reporter = replaceUser(issue.fields.reporter);
        if (issue.fields.creator) issue.fields.creator = replaceUser(issue.fields.creator);
      }

      if (usersMap.size > 0) {
        cleaned._users = Array.from(usersMap.values());
      }
    }

    return cleaned;
  };

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
    "moveToBacklog",
  ]);
  const IssueActionSchema = z.union([z.literal("/help"), IssueActionEnum]);

  // --- manageJiraProject: unified project management ---
  server.tool(
    "manageJiraProject",
    "Unified Jira project tool. Commands: listProjects, getProject, createProject, getIssueTypes, getBoards. Pass command='/help' for usage.",
    {
      command: z.enum(["listProjects", "getProject", "createProject", "getIssueTypes", "getBoards", "/help"])
        .describe("The operation to perform."),
      projectIdOrKey: z.string().optional().describe("Project key or ID (required for getProject, getIssueTypes, getBoards)."),
      expand: z.string().optional().describe("Comma-separated expansions for getProject (e.g. 'description,lead,issueTypes')."),
      // createProject fields
      key: z.string().optional().describe("Project key for createProject (uppercase, max 10 chars, e.g. 'TEST')."),
      name: z.string().optional().describe("Project name for createProject."),
      projectTypeKey: z.string().optional().describe("Project type for createProject ('software', 'business', 'service_desk')."),
      leadAccountId: z.string().optional().describe("Lead account ID for createProject. Use manageJiraUsers to find IDs."),
      projectTemplateKey: z.string().optional().describe("Template key for createProject (may be required by your Jira instance)."),
      description: z.string().optional().describe("Project description for createProject."),
      url: z.string().optional().describe("Project URL for createProject."),
      assigneeType: z.string().optional().describe("Assignee type for createProject ('PROJECT_LEAD' or 'UNASSIGNED')."),
      categoryId: z.number().optional().describe("Category ID for createProject."),
    },
    async (input) => {
      if (input.command === "/help") {
        return {
          content: [{
            text: `manageJiraProject commands:
- listProjects: list all Jira projects
- getProject: get project details (requires projectIdOrKey, optional expand)
- createProject: create a project (requires key, name, projectTypeKey, leadAccountId)
- getIssueTypes: list issue types for a project (requires projectIdOrKey)
- getBoards: list Agile boards for a project (requires projectIdOrKey)`,
            type: "text",
          }],
        };
      }

      const jiraClient = await getJiraClient();

      switch (input.command) {
        case "listProjects": {
          const projects = await jiraClient.getProjects();
          const normalized = stripAvatarUrls(projects.map((p) => ({
            id: p.id, key: p.key, name: p.name, projectTypeKey: p.projectTypeKey,
          })));
          return {
            content: [{ text: JSON.stringify({ success: true, projects: normalized }, null, 2), type: "text" }],
          };
        }
        case "getProject": {
          if (!input.projectIdOrKey) throw new Error("getProject requires projectIdOrKey.");
          const project = await jiraClient.getProject(input.projectIdOrKey, input.expand);
          const data = stripAvatarUrls({
            id: project.id, key: project.key, name: project.name,
            projectTypeKey: project.projectTypeKey,
            description: project.description || null,
            lead: normalizeUser(project.lead),
          });
          return {
            content: [{ text: JSON.stringify({ success: true, ...data }, null, 2), type: "text" }],
          };
        }
        case "createProject": {
          if (!input.key) throw new Error("createProject requires key.");
          if (!input.name) throw new Error("createProject requires name.");
          if (!input.projectTypeKey) throw new Error("createProject requires projectTypeKey.");
          if (!input.leadAccountId) throw new Error("createProject requires leadAccountId. Use manageJiraUsers to find valid account IDs.");
          const payload = {
            key: input.key, name: input.name, projectTypeKey: input.projectTypeKey,
            leadAccountId: input.leadAccountId,
          };
          if (input.projectTemplateKey) payload.projectTemplateKey = input.projectTemplateKey;
          if (input.description) payload.description = input.description;
          if (input.url) payload.url = input.url;
          if (input.assigneeType) payload.assigneeType = input.assigneeType;
          if (input.categoryId) payload.categoryId = input.categoryId;
          const newProject = await jiraClient.createProject(payload);
          const data = stripAvatarUrls({
            id: newProject.id, key: newProject.key, name: newProject.name,
            projectTypeKey: newProject.projectTypeKey,
            lead: normalizeUser(newProject.lead),
          });
          return {
            content: [{ text: JSON.stringify({ success: true, ...data }, null, 2), type: "text" }],
          };
        }
        case "getIssueTypes": {
          if (!input.projectIdOrKey) throw new Error("getIssueTypes requires projectIdOrKey.");
          const issueTypes = await jiraClient.getProjectIssueTypes(input.projectIdOrKey);
          const types = (issueTypes || []).map((t) => ({
            id: t.id, name: t.name, subtask: t.subtask === true, default: t.default === true,
          }));
          return {
            content: [{ text: JSON.stringify({ success: true, projectKey: input.projectIdOrKey, issueTypes: types }, null, 2), type: "text" }],
          };
        }
        case "getBoards": {
          if (!input.projectIdOrKey) throw new Error("getBoards requires projectIdOrKey.");
          const boards = await jiraClient.getBoardsForProject(input.projectIdOrKey);
          const data = boards.map((b) => ({ id: b.id, name: b.name, type: b.type }));
          return {
            content: [{ text: JSON.stringify({ success: true, projectKey: input.projectIdOrKey, boards: data }, null, 2), type: "text" }],
          };
        }
        default:
          throw new Error(`Unknown command: ${input.command}`);
      }
    },
  );
  registeredTools.push("manageJiraProject");

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
      assignee: z.string().optional().describe("Assignee account ID for assignIssue/unassignIssue, or when creating/updating an issue. Use manageJiraUsers to find valid account IDs."),
      attachmentId: z.string().optional().describe("Attachment ID for deleteAttachment."),
      boardId: z.number().optional().describe("Board ID for moveToBacklog."),
      issueIdsOrKeys: z.array(z.string()).optional().describe("Array of issue IDs or keys for moveToBacklog."),
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
- assignIssue | unassignIssue: assign or unassign a user on an issue (use manageJiraUsers to find account IDs)
- moveToBacklog: move issues to the backlog (requires boardId + issueIdsOrKeys)
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
          const responseData = normalizeResponse({
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
          });
          return {
            content: [{ text: JSON.stringify(responseData, null, 2), type: "text" }],
            data: { success: true },
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

          const normalized = normalizeResponse(results);
          return {
            content: [
              {
                text: `Found ${typeof results.total === "number" ? results.total : issues.length} issues. First page:\n${lines.join("\n")}`,
                type: "text",
              },
            ],
            data: { success: true, ...normalized },
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
        case "moveToBacklog": {
          if (!input.boardId) throw new Error("moveToBacklog requires boardId.");
          if (!input.issueIdsOrKeys || input.issueIdsOrKeys.length === 0) throw new Error("moveToBacklog requires issueIdsOrKeys.");
          await jiraClient.moveIssuesToBacklog(input.boardId, input.issueIdsOrKeys);
          return {
            content: [{ text: `Moved ${input.issueIdsOrKeys.length} issue(s) to backlog for board ${input.boardId}.`, type: "text" }],
            data: { success: true, boardId: input.boardId, issueIdsOrKeys: input.issueIdsOrKeys },
          };
        }
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    },
  );
  registeredTools.push("jiraIssueToolkit");

  // --- manageJiraSprint: unified sprint management ---
  server.tool(
    "manageJiraSprint",
    "Unified Jira sprint tool. Commands: listSprints, getSprint, createSprint, startSprint, completeSprint, updateSprint, deleteSprint, getIssues, moveIssues. Pass command='/help' for usage.",
    {
      command: z.enum(["listSprints", "getSprint", "createSprint", "startSprint", "completeSprint", "updateSprint", "deleteSprint", "getIssues", "moveIssues", "/help"])
        .describe("The operation to perform."),
      sprintId: z.number().optional().describe("Sprint ID (required for most commands except listSprints and createSprint)."),
      boardId: z.number().optional().describe("Board ID (required for listSprints, also used as originBoardId for createSprint)."),
      name: z.string().optional().describe("Sprint name (required for createSprint, optional for start/complete/update)."),
      startDate: z.string().optional().describe("Start date in ISO format (e.g. '2025-06-30T08:00:00.000Z')."),
      endDate: z.string().optional().describe("End date in ISO format (e.g. '2025-07-14T17:00:00.000Z')."),
      goal: z.string().optional().describe("Sprint goal (for createSprint or updateSprint)."),
      state: z.enum(["future", "active", "closed"]).optional().describe("New state for updateSprint."),
      issueIdsOrKeys: z.array(z.string()).optional().describe("Array of issue IDs or keys (for moveIssues)."),
    },
    async (input) => {
      if (input.command === "/help") {
        return {
          content: [{
            text: `manageJiraSprint commands:
- listSprints: list all sprints for a board (requires boardId)
- getSprint: get sprint details (requires sprintId)
- createSprint: create a sprint (requires boardId + name, optional startDate/endDate/goal)
- startSprint: start a sprint (requires sprintId, optional name/startDate/endDate)
- completeSprint: complete an active sprint (requires sprintId, optional name/startDate/endDate)
- updateSprint: update sprint metadata (requires sprintId, optional name/startDate/endDate/state/goal)
- deleteSprint: delete a sprint (requires sprintId)
- getIssues: list issues in a sprint (requires sprintId)
- moveIssues: move issues to a sprint (requires sprintId + issueIdsOrKeys)`,
            type: "text",
          }],
        };
      }

      const jiraClient = await getJiraClient();

      switch (input.command) {
        case "listSprints": {
          if (!input.boardId) throw new Error("listSprints requires boardId. Use manageJiraProject command=getBoards to find board IDs.");
          const sprints = await jiraClient.getSprintsForBoard(input.boardId);
          const data = sprints.map((s) => ({ id: s.id, name: s.name, state: s.state, startDate: s.startDate, endDate: s.endDate, goal: s.goal }));
          return {
            content: [{ text: JSON.stringify({ success: true, boardId: input.boardId, sprints: data }, null, 2), type: "text" }],
          };
        }
        case "getSprint": {
          if (!input.sprintId) throw new Error("getSprint requires sprintId.");
          const sprint = await jiraClient.getSprint(input.sprintId);
          const data = stripAvatarUrls({ id: sprint.id, name: sprint.name, state: sprint.state, startDate: sprint.startDate, endDate: sprint.endDate, goal: sprint.goal, originBoardId: sprint.originBoardId });
          return {
            content: [{ text: JSON.stringify({ success: true, ...data }, null, 2), type: "text" }],
          };
        }
        case "createSprint": {
          if (!input.boardId) throw new Error("createSprint requires boardId.");
          if (!input.name) throw new Error("createSprint requires name.");
          const payload = { name: input.name, originBoardId: input.boardId };
          if (input.startDate) payload.startDate = input.startDate;
          if (input.endDate) payload.endDate = input.endDate;
          if (input.goal) payload.goal = input.goal;
          const newSprint = await jiraClient.createSprint(payload);
          return {
            content: [{ text: JSON.stringify({ success: true, id: newSprint.id, name: newSprint.name, state: newSprint.state }, null, 2), type: "text" }],
          };
        }
        case "startSprint": {
          if (!input.sprintId) throw new Error("startSprint requires sprintId.");
          await jiraClient.startSprint(input.sprintId, { name: input.name, startDate: input.startDate, endDate: input.endDate });
          return {
            content: [{ text: JSON.stringify({ success: true, sprintId: input.sprintId, action: "started" }, null, 2), type: "text" }],
          };
        }
        case "completeSprint": {
          if (!input.sprintId) throw new Error("completeSprint requires sprintId.");
          try {
            await jiraClient.completeSprint(input.sprintId, { name: input.name, startDate: input.startDate, endDate: input.endDate });
            return {
              content: [{ text: JSON.stringify({ success: true, sprintId: input.sprintId, action: "completed" }, null, 2), type: "text" }],
            };
          } catch (error) {
            const msg = error?.message || String(error);
            return { content: [{ text: `Error completing sprint ${input.sprintId}: ${msg}`, type: "text" }], isError: true };
          }
        }
        case "updateSprint": {
          if (!input.sprintId) throw new Error("updateSprint requires sprintId.");
          const updatedSprint = await jiraClient.updateSprint(input.sprintId, { name: input.name, startDate: input.startDate, endDate: input.endDate, state: input.state, goal: input.goal });
          return {
            content: [{ text: JSON.stringify({ success: true, id: updatedSprint.id, name: updatedSprint.name }, null, 2), type: "text" }],
          };
        }
        case "deleteSprint": {
          if (!input.sprintId) throw new Error("deleteSprint requires sprintId.");
          await jiraClient.deleteSprint(input.sprintId);
          return {
            content: [{ text: JSON.stringify({ success: true, sprintId: input.sprintId, action: "deleted" }, null, 2), type: "text" }],
          };
        }
        case "getIssues": {
          if (!input.sprintId) throw new Error("getIssues requires sprintId.");
          const issues = await jiraClient.getIssuesForSprint(input.sprintId);
          const normalized = normalizeResponse({ issues });
          return {
            content: [{ text: JSON.stringify({ success: true, sprintId: input.sprintId, count: issues.length, ...normalized }, null, 2), type: "text" }],
          };
        }
        case "moveIssues": {
          if (!input.sprintId) throw new Error("moveIssues requires sprintId.");
          if (!input.issueIdsOrKeys || input.issueIdsOrKeys.length === 0) throw new Error("moveIssues requires issueIdsOrKeys.");
          await jiraClient.moveIssuesToSprint(input.sprintId, input.issueIdsOrKeys);
          return {
            content: [{ text: JSON.stringify({ success: true, sprintId: input.sprintId, moved: input.issueIdsOrKeys }, null, 2), type: "text" }],
          };
        }
        default:
          throw new Error(`Unknown command: ${input.command}`);
      }
    },
  );
  registeredTools.push("manageJiraSprint");

  // --- manageJiraUsers: unified user management ---
  server.tool(
    "manageJiraUsers",
    "Unified Jira user tool. Commands: searchUsers, getUser, createUser, deleteUser. Pass command='/help' for usage.",
    {
      command: z.enum(["searchUsers", "getUser", "createUser", "deleteUser", "/help"])
        .describe("The operation to perform."),
      accountId: z.string().optional().describe("Account ID (required for getUser, deleteUser)."),
      query: z.string().optional().describe("Search query for searchUsers (name, email, or username; partial matches supported)."),
      maxResults: z.number().optional().describe("Max results for searchUsers (default 10)."),
      emailAddress: z.string().optional().describe("Email for createUser."),
      password: z.string().optional().describe("Password for createUser."),
      displayName: z.string().optional().describe("Display name for createUser."),
    },
    async (input) => {
      if (input.command === "/help") {
        return {
          content: [{
            text: `manageJiraUsers commands:
- searchUsers: find users by name/email/username (requires query, optional maxResults)
- getUser: get user details (requires accountId)
- createUser: create a user (requires emailAddress, password, displayName)
- deleteUser: delete a user (requires accountId)`,
            type: "text",
          }],
        };
      }

      const jiraClient = await getJiraClient();

      switch (input.command) {
        case "searchUsers": {
          if (!input.query) throw new Error("searchUsers requires query.");
          const response = await jiraClient.searchUsers(input.query, input.maxResults ?? 10);
          if (!Array.isArray(response) || response.length === 0) {
            return { content: [{ text: JSON.stringify({ success: true, query: input.query, users: [] }, null, 2), type: "text" }] };
          }
          const users = response.map((u) => ({
            accountId: u.accountId, displayName: u.displayName,
            email: u.emailAddress || null, active: u.active,
          }));
          return {
            content: [{ text: JSON.stringify({ success: true, query: input.query, users }, null, 2), type: "text" }],
          };
        }
        case "getUser": {
          if (!input.accountId) throw new Error("getUser requires accountId.");
          const user = await jiraClient.getUser(input.accountId);
          const data = stripAvatarUrls({
            accountId: user.accountId, displayName: user.displayName,
            email: user.emailAddress, active: user.active, timeZone: user.timeZone,
          });
          return {
            content: [{ text: JSON.stringify({ success: true, ...data }, null, 2), type: "text" }],
          };
        }
        case "createUser": {
          if (!input.emailAddress) throw new Error("createUser requires emailAddress.");
          if (!input.password) throw new Error("createUser requires password.");
          if (!input.displayName) throw new Error("createUser requires displayName.");
          const newUser = await jiraClient.createUser({ emailAddress: input.emailAddress, password: input.password, displayName: input.displayName });
          return {
            content: [{ text: JSON.stringify({ success: true, accountId: newUser.accountId, displayName: newUser.displayName }, null, 2), type: "text" }],
          };
        }
        case "deleteUser": {
          if (!input.accountId) throw new Error("deleteUser requires accountId.");
          await jiraClient.deleteUser(input.accountId);
          return {
            content: [{ text: JSON.stringify({ success: true, accountId: input.accountId, action: "deleted" }, null, 2), type: "text" }],
          };
        }
        default:
          throw new Error(`Unknown command: ${input.command}`);
      }
    },
  );
  registeredTools.push("manageJiraUsers");

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

  // --- manageBackendJobs: unified backend job queue management ---
  server.tool(
    "manageBackendJobs",
    "Unified backend job queue tool. Commands: enqueue, getStatus, getStats. Pass command='/help' for usage.",
    {
      command: z.enum(["enqueue", "getStatus", "getStats", "/help"])
        .describe("The operation to perform."),
      jobId: z.number().optional().describe("Job ID (required for getStatus)."),
      jobType: z.string().optional().describe("Job type for enqueue (e.g. 'stripe_migration', 'data_export', 'cleanup')."),
      payload: z.record(z.unknown()).optional().describe("JSON payload for enqueue."),
      priority: z.enum(["low", "normal", "high", "critical"]).optional().describe("Priority for enqueue (default 'normal')."),
      maxAttempts: z.number().optional().describe("Max retry attempts for enqueue (default 3)."),
    },
    async (input) => {
      if (input.command === "/help") {
        return {
          content: [{
            text: `manageBackendJobs commands:
- enqueue: enqueue a job (requires jobType, optional payload/priority/maxAttempts)
- getStatus: check job status (requires jobId)
- getStats: get queue statistics (no params)`,
            type: "text",
          }],
        };
      }

      const backendBase = this.env.BACKEND_BASE_URL;
      if (!backendBase) {
        return { content: [{ text: "Error: BACKEND_BASE_URL is not configured.", type: "text" }], isError: true };
      }

      switch (input.command) {
        case "enqueue": {
          if (!input.jobType) throw new Error("enqueue requires jobType.");
          const url = new URL("/api/jobs", backendBase);
          const response = await fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_type: input.jobType,
              payload: input.payload || {},
              priority: input.priority || "normal",
              max_attempts: input.maxAttempts || 3,
            }),
          });
          if (!response.ok) {
            const errorText = await response.text();
            return { content: [{ text: `Error enqueuing job: ${response.status} - ${errorText}`, type: "text" }], isError: true };
          }
          const result = await response.json();
          return {
            content: [{ text: JSON.stringify({ success: true, id: result.id, status: result.status }, null, 2), type: "text" }],
          };
        }
        case "getStatus": {
          if (!input.jobId) throw new Error("getStatus requires jobId.");
          const url = new URL("/api/jobs", backendBase);
          url.searchParams.set("id", String(input.jobId));
          const response = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
          if (!response.ok) {
            const errorText = await response.text();
            return { content: [{ text: `Error fetching job: ${response.status} - ${errorText}`, type: "text" }], isError: true };
          }
          const job = await response.json();
          return {
            content: [{ text: JSON.stringify({ success: true, id: job.id, jobType: job.job_type, status: job.status, priority: job.priority, attempts: job.attempts, maxAttempts: job.max_attempts, lastError: job.last_error || null, completedAt: job.completed_at || null }, null, 2), type: "text" }],
          };
        }
        case "getStats": {
          const url = new URL("/api/jobs/stats", backendBase);
          const response = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
          if (!response.ok) {
            const errorText = await response.text();
            return { content: [{ text: `Error fetching stats: ${response.status} - ${errorText}`, type: "text" }], isError: true };
          }
          const stats = await response.json();
          return {
            content: [{ text: JSON.stringify({ success: true, ...stats }, null, 2), type: "text" }],
          };
        }
        default:
          throw new Error(`Unknown command: ${input.command}`);
      }
    },
  );
  registeredTools.push("manageBackendJobs");

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

