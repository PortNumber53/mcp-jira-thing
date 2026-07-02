import { z } from "zod";

/**
 * Register workflow-oriented Jira tools on the MCP server.
 *
 * These tools replace the old API-endpoint-mirroring tools with higher-level
 * workflow tools that surface contextual information and handle ID resolution
 * internally, so LLMs can work with Jira projects naturally without needing
 * to know JQL, transition IDs, or account IDs.
 *
 * @param {object} server - McpServer instance
 * @param {function} getJiraClient - async function returning a JiraClient
 * @param {object} helpers - { stripAvatarUrls, normalizeUser, normalizeResponse }
 * @returns {string[]} names of registered tools
 */
export async function registerJiraWorkflowTools(server, getJiraClient, helpers) {
  const { stripAvatarUrls, normalizeUser, normalizeResponse } = helpers;
  const registeredTools = [];

  // ── Internal helpers ──────────────────────────────────────

  // Resolve an assignee name/email to accountId
  const resolveAssignee = async (jiraClient, assigneeInput) => {
    if (!assigneeInput) return undefined;
    if (/^[0-9a-f]{20,}$/i.test(assigneeInput)) return assigneeInput;
    const users = await jiraClient.searchUsers(assigneeInput, 5).catch(() => []);
    if (users.length === 0)
      throw new Error(
        `Could not find user "${assigneeInput}". Use findPeople to search for valid users.`,
      );
    const exact = users.find(
      (u) =>
        u.displayName?.toLowerCase() === assigneeInput.toLowerCase() ||
        u.emailAddress?.toLowerCase() === assigneeInput.toLowerCase(),
    );
    return (exact || users[0]).accountId;
  };

  // Resolve an issue type name to { id } for a project
  const resolveIssueType = async (jiraClient, projectKey, issueTypeName) => {
    if (!issueTypeName) return undefined;
    if (/^\d+$/.test(issueTypeName)) return { id: issueTypeName };
    const types = await jiraClient.getProjectIssueTypes(projectKey).catch(() => []);
    const match = types.find(
      (t) => t.name?.toLowerCase() === issueTypeName.toLowerCase(),
    );
    if (!match)
      throw new Error(
        `Issue type "${issueTypeName}" not found in project ${projectKey}. Available: ${types.map((t) => t.name).join(", ")}`,
      );
    return { id: match.id };
  };

  // Resolve a target status name to a transition ID for an issue
  const resolveTransition = async (jiraClient, issueKey, statusName) => {
    if (!statusName) return undefined;
    if (/^\d+$/.test(statusName)) return statusName;
    const resp = await jiraClient.getTransitions(issueKey);
    const match = resp.transitions.find(
      (t) =>
        t.to?.name?.toLowerCase() === statusName.toLowerCase() ||
        t.name?.toLowerCase() === statusName.toLowerCase(),
    );
    if (!match)
      throw new Error(
        `No transition to "${statusName}" for ${issueKey}. Available: ${resp.transitions.map((t) => `${t.name}→${t.to?.name}`).join(", ")}`,
      );
    return match.id;
  };

  // Build JQL from structured filters
  const buildJql = (filters) => {
    const parts = [];
    if (filters.projectKey) parts.push(`project = ${filters.projectKey}`);
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      const statusParts = statuses.map((s) => `status = "${s}"`);
      parts.push(`(${statusParts.join(" OR ")})`);
    }
    if (filters.statusCategory) {
      parts.push(`statusCategory = "${filters.statusCategory}"`);
    }
    if (filters.assignee) parts.push(`assignee = "${filters.assignee}"`);
    if (filters.issueType) parts.push(`issuetype = "${filters.issueType}"`);
    if (filters.priority) parts.push(`priority = "${filters.priority}"`);
    if (filters.labels && filters.labels.length > 0) {
      const labelParts = filters.labels.map((l) => `labels = "${l}"`);
      parts.push(`(${labelParts.join(" OR ")})`);
    }
    if (filters.sprintId) parts.push(`sprint = ${filters.sprintId}`);
    if (filters.text) parts.push(`text ~ "${filters.text}"`);
    if (filters.updatedWithin) parts.push(`updated >= -${filters.updatedWithin}d`);
    if (filters.createdWithin) parts.push(`created >= -${filters.createdWithin}d`);
    return parts.join(" AND ");
  };

  // Format an issue as a one-line summary
  const formatIssueLine = (issue) => {
    const summary = issue.fields?.summary ?? "(no summary)";
    const status = issue.fields?.status?.name ?? "Unknown";
    const assignee = issue.fields?.assignee?.displayName ?? "Unassigned";
    const type = issue.fields?.issuetype?.name ?? "?";
    return `${issue.key}: ${summary} [${type}/${status}] — ${assignee}`;
  };

  // ── 1. getProjectOverview ─────────────────────────────────

  server.tool(
    "getProjectOverview",
    "Get a comprehensive overview of a Jira project: details, active sprint, backlog count, issue types, boards, recent activity, and stale issues. Set listProjects=true to list all projects instead.",
    {
      projectKey: z.string().optional().describe("Project key (e.g. 'ENG'). Required unless listProjects is true."),
      listProjects: z.boolean().optional().describe("If true, returns a simple list of all projects."),
    },
    async (input) => {
      const jiraClient = await getJiraClient();

      if (input.listProjects) {
        const projects = await jiraClient.getProjects();
        const list = projects.map((p) => ({
          id: p.id, key: p.key, name: p.name, projectTypeKey: p.projectTypeKey,
        }));
        return {
          content: [
            {
              text: `Found ${list.length} projects:\n${list.map((p) => `- ${p.key}: ${p.name}`).join("\n")}`,
              type: "text",
            },
          ],
          data: { success: true, projects: list },
        };
      }

      if (!input.projectKey)
        throw new Error("projectKey is required (or set listProjects=true).");

      const [project, issueTypes, boards] = await Promise.all([
        jiraClient.getProject(input.projectKey).catch(() => null),
        jiraClient.getProjectIssueTypes(input.projectKey).catch(() => []),
        jiraClient.getBoardsForProject(input.projectKey).catch(() => []),
      ]);

      if (!project) throw new Error(`Project "${input.projectKey}" not found.`);

      // Find active sprint from first board
      let sprintSummary = null;
      if (boards.length > 0) {
        const sprints = await jiraClient.getSprintsForBoard(boards[0].id).catch(() => []);
        const active = sprints.find((s) => s.state === "active");
        if (active) {
          const sprintIssues = await jiraClient.getIssuesForSprint(active.id).catch(() => []);
          const done = sprintIssues.filter((i) => i.fields?.status?.statusCategory?.name === "Done").length;
          const inProgress = sprintIssues.filter((i) => i.fields?.status?.statusCategory?.name === "In Progress").length;
          const toDo = sprintIssues.filter((i) => i.fields?.status?.statusCategory?.name === "To Do").length;
          const total = sprintIssues.length;
          const daysLeft = active.endDate
            ? Math.ceil((new Date(active.endDate).getTime() - Date.now()) / 86400000)
            : null;
          sprintSummary = {
            id: active.id, name: active.name, goal: active.goal,
            startDate: active.startDate, endDate: active.endDate,
            daysLeft, total, done, inProgress, toDo,
          };
        }
      }

      // Backlog count, recent activity, stale issues in parallel
      const [backlogResult, recentResult, staleResult] = await Promise.all([
        jiraClient
          .searchIssues(
            `project = ${input.projectKey} AND sprint IS EMPTY AND statusCategory != Done ORDER BY priority DESC`,
            { maxResults: 1 },
          )
          .catch(() => ({ total: 0 })),
        jiraClient
          .searchIssues(`project = ${input.projectKey} ORDER BY updated DESC`, {
            maxResults: 5,
            fields: ["summary", "status", "updated", "assignee", "issuetype"],
          })
          .catch(() => ({ issues: [] })),
        jiraClient
          .searchIssues(
            `project = ${input.projectKey} AND statusCategory != Done AND updated <= -14d ORDER BY updated ASC`,
            { maxResults: 10, fields: ["summary", "status", "updated", "assignee"] },
          )
          .catch(() => ({ issues: [] })),
      ]);

      const projectData = {
        key: project.key,
        name: project.name,
        description: project.description || null,
        lead: normalizeUser(project.lead),
        projectTypeKey: project.projectTypeKey,
      };
      const types = (issueTypes || []).map((t) => ({
        id: t.id, name: t.name, subtask: t.subtask === true,
      }));
      const boardList = (boards || []).map((b) => ({
        id: b.id, name: b.name, type: b.type,
      }));
      const recent = (recentResult.issues || []).map((i) => ({
        key: i.key,
        summary: i.fields?.summary,
        status: i.fields?.status?.name,
        updated: i.fields?.updated,
      }));
      const stale = (staleResult.issues || []).map((i) => ({
        key: i.key,
        summary: i.fields?.summary,
        status: i.fields?.status?.name,
        updated: i.fields?.updated,
        assignee: i.fields?.assignee?.displayName || "Unassigned",
      }));

      const lines = [];
      lines.push(`Project: ${projectData.name} (${projectData.key})`);
      lines.push(`Lead: ${projectData.lead?.displayName || "Unknown"}`);
      if (projectData.description)
        lines.push(`Description: ${projectData.description.substring(0, 200)}`);
      if (sprintSummary) {
        lines.push(`\nActive Sprint: ${sprintSummary.name}`);
        if (sprintSummary.goal) lines.push(`Goal: ${sprintSummary.goal}`);
        lines.push(
          `Progress: ${sprintSummary.done}/${sprintSummary.total} done, ${sprintSummary.inProgress} in progress, ${sprintSummary.toDo} to do`,
        );
        if (sprintSummary.daysLeft !== null)
          lines.push(`Days remaining: ${sprintSummary.daysLeft}`);
      } else {
        lines.push("\nNo active sprint.");
      }
      lines.push(`\nBacklog: ${backlogResult.total || 0} issues`);
      lines.push(`Issue types: ${types.map((t) => t.name).join(", ")}`);
      if (boardList.length)
        lines.push(`Boards: ${boardList.map((b) => `${b.name} (${b.id})`).join(", ")}`);
      if (recent.length) {
        lines.push("\nRecent activity:");
        recent.forEach((r) => lines.push(`  ${r.key}: ${r.summary} [${r.status}]`));
      }
      if (stale.length) {
        lines.push("\n⚠️ Stale issues (no update in 14+ days):");
        stale.forEach((r) =>
          lines.push(`  ${r.key}: ${r.summary} [${r.status}] — ${r.assignee} (updated ${r.updated})`),
        );
      } else {
        lines.push("\n✓ No stale issues.");
      }

      return {
        content: [{ text: lines.join("\n"), type: "text" }],
        data: {
          success: true,
          project: projectData,
          activeSprint: sprintSummary,
          backlogCount: backlogResult.total || 0,
          issueTypes: types,
          boards: boardList,
          recentActivity: recent,
          staleIssues: stale,
        },
      };
    },
  );
  registeredTools.push("getProjectOverview");

  // ── 2. getSprintBoard ─────────────────────────────────────

  server.tool(
    "getSprintBoard",
    "View a sprint board: issues grouped by status (To Do / In Progress / Done), assignee workload, and progress percentages. Provide sprintId directly or projectKey to auto-find the active sprint.",
    {
      sprintId: z.number().optional().describe("Sprint ID to view. If omitted, projectKey is used to find the active sprint."),
      projectKey: z.string().optional().describe("Project key — used to find the active sprint when sprintId is not provided."),
    },
    async (input) => {
      const jiraClient = await getJiraClient();
      let sprintId = input.sprintId;

      if (!sprintId) {
        if (!input.projectKey)
          throw new Error("Either sprintId or projectKey is required.");
        const boards = await jiraClient.getBoardsForProject(input.projectKey).catch(() => []);
        if (boards.length === 0)
          throw new Error(`No boards found for project ${input.projectKey}.`);
        const sprints = await jiraClient.getSprintsForBoard(boards[0].id).catch(() => []);
        const active = sprints.find((s) => s.state === "active");
        if (!active)
          throw new Error(`No active sprint found for project ${input.projectKey}.`);
        sprintId = active.id;
      }

      const [sprint, issues] = await Promise.all([
        jiraClient.getSprint(sprintId),
        jiraClient.getIssuesForSprint(sprintId).catch(() => []),
      ]);

      const toDo = issues.filter((i) => i.fields?.status?.statusCategory?.name === "To Do");
      const inProgress = issues.filter((i) => i.fields?.status?.statusCategory?.name === "In Progress");
      const done = issues.filter((i) => i.fields?.status?.statusCategory?.name === "Done");
      const total = issues.length;

      // Assignee workload
      const workload = new Map();
      for (const issue of issues) {
        const name = issue.fields?.assignee?.displayName || "Unassigned";
        if (!workload.has(name)) workload.set(name, { total: 0, done: 0 });
        const w = workload.get(name);
        w.total++;
        if (done.includes(issue)) w.done++;
      }

      const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

      const lines = [];
      lines.push(`Sprint: ${sprint.name} (${sprint.state})`);
      if (sprint.goal) lines.push(`Goal: ${sprint.goal}`);
      lines.push(`Dates: ${sprint.startDate || "?"} → ${sprint.endDate || "?"}`);
      lines.push(`\nProgress: ${done.length}/${total} done (${pct(done.length)}%), ${inProgress.length} in progress (${pct(inProgress.length)}%), ${toDo.length} to do (${pct(toDo.length)}%)`);

      lines.push("\n📋 To Do:");
      toDo.forEach((i) => lines.push(`  ${formatIssueLine(i)}`));
      if (toDo.length === 0) lines.push("  (none)");

      lines.push("\n🔄 In Progress:");
      inProgress.forEach((i) => lines.push(`  ${formatIssueLine(i)}`));
      if (inProgress.length === 0) lines.push("  (none)");

      lines.push("\n✅ Done:");
      done.forEach((i) => lines.push(`  ${formatIssueLine(i)}`));
      if (done.length === 0) lines.push("  (none)");

      lines.push("\n👥 Assignee workload:");
      for (const [name, w] of workload) {
        lines.push(`  ${name}: ${w.done}/${w.total} done`);
      }

      return {
        content: [{ text: lines.join("\n"), type: "text" }],
        data: {
          success: true,
          sprint: { id: sprint.id, name: sprint.name, state: sprint.state, goal: sprint.goal, startDate: sprint.startDate, endDate: sprint.endDate },
          summary: { total, done: done.length, inProgress: inProgress.length, toDo: toDo.length },
          toDo: toDo.map((i) => ({ key: i.key, summary: i.fields?.summary, status: i.fields?.status?.name, assignee: i.fields?.assignee?.displayName })),
          inProgress: inProgress.map((i) => ({ key: i.key, summary: i.fields?.summary, status: i.fields?.status?.name, assignee: i.fields?.assignee?.displayName })),
          done: done.map((i) => ({ key: i.key, summary: i.fields?.summary, status: i.fields?.status?.name, assignee: i.fields?.assignee?.displayName })),
          workload: Array.from(workload.entries()).map(([name, w]) => ({ assignee: name, total: w.total, done: w.done })),
        },
      };
    },
  );
  registeredTools.push("getSprintBoard");

  // ── 3. manageBacklog ──────────────────────────────────────

  server.tool(
    "manageBacklog",
    "Manage the project backlog: list issues, move issues to a sprint, or move issues back to the backlog.",
    {
      command: z.enum(["list", "moveToSprint", "moveToBacklog", "/help"]).describe("The operation to perform."),
      projectKey: z.string().optional().describe("Project key (required for 'list')."),
      sprintId: z.number().optional().describe("Target sprint ID for moveToSprint."),
      boardId: z.number().optional().describe("Board ID for moveToBacklog (defaults to first board of the project)."),
      issueKeys: z.array(z.string()).optional().describe("Issue keys to move (required for moveToSprint/moveToBacklog)."),
      maxResults: z.number().optional().describe("Max issues to return for 'list' (default 50)."),
    },
    async (input) => {
      if (input.command === "/help") {
        return {
          content: [{
            text: `manageBacklog commands:
- list: list backlog issues for a project (requires projectKey)
- moveToSprint: move issues to a sprint (requires sprintId + issueKeys)
- moveToBacklog: move issues to the backlog (requires issueKeys, optional boardId or projectKey)`,
            type: "text",
          }],
        };
      }

      const jiraClient = await getJiraClient();

      switch (input.command) {
        case "list": {
          if (!input.projectKey) throw new Error("list requires projectKey.");
          const jql = `project = ${input.projectKey} AND sprint IS EMPTY AND statusCategory != Done ORDER BY priority DESC, key ASC`;
          const results = await jiraClient.searchIssues(jql, {
            maxResults: input.maxResults ?? 50,
            fields: ["summary", "status", "priority", "assignee", "issuetype"],
          });
          const issues = (results.issues || []).map((i) => ({
            key: i.key,
            summary: i.fields?.summary,
            status: i.fields?.status?.name,
            priority: i.fields?.priority?.name,
            assignee: i.fields?.assignee?.displayName || "Unassigned",
            type: i.fields?.issuetype?.name,
          }));
          const lines = [
            `Backlog for ${input.projectKey}: ${results.total || issues.length} issues`,
            ...issues.map((i) => `  ${i.key}: ${i.summary} [${i.type}/${i.status}/${i.priority}] — ${i.assignee}`),
          ];
          return {
            content: [{ text: lines.join("\n"), type: "text" }],
            data: { success: true, projectKey: input.projectKey, total: results.total, issues },
          };
        }
        case "moveToSprint": {
          if (!input.sprintId) throw new Error("moveToSprint requires sprintId.");
          if (!input.issueKeys || input.issueKeys.length === 0)
            throw new Error("moveToSprint requires issueKeys.");
          await jiraClient.moveIssuesToSprint(input.sprintId, input.issueKeys);
          return {
            content: [{ text: `Moved ${input.issueKeys.length} issue(s) to sprint ${input.sprintId}.`, type: "text" }],
            data: { success: true, sprintId: input.sprintId, moved: input.issueKeys },
          };
        }
        case "moveToBacklog": {
          if (!input.issueKeys || input.issueKeys.length === 0)
            throw new Error("moveToBacklog requires issueKeys.");
          let boardId = input.boardId;
          if (!boardId) {
            if (!input.projectKey) throw new Error("moveToBacklog requires boardId or projectKey.");
            const boards = await jiraClient.getBoardsForProject(input.projectKey).catch(() => []);
            if (boards.length === 0) throw new Error(`No boards found for project ${input.projectKey}.`);
            boardId = boards[0].id;
          }
          await jiraClient.moveIssuesToBacklog(boardId, input.issueKeys);
          return {
            content: [{ text: `Moved ${input.issueKeys.length} issue(s) to backlog (board ${boardId}).`, type: "text" }],
            data: { success: true, boardId, moved: input.issueKeys },
          };
        }
        default:
          throw new Error(`Unknown command: ${input.command}`);
      }
    },
  );
  registeredTools.push("manageBacklog");

  // ── 4. createWorkItem ─────────────────────────────────────

  server.tool(
    "createWorkItem",
    "Create a Jira issue with smart resolution: issue type by name, assignee by name/email, priority by name. Validates against the project's available issue types. Optionally link to a parent epic.",
    {
      projectKey: z.string().describe("Project key (e.g. 'ENG')."),
      summary: z.string().describe("Issue title/summary."),
      issueType: z.string().describe("Issue type name (e.g. 'Bug', 'Task', 'Story', 'Epic'). Resolved automatically."),
      description: z.string().optional().describe("Plain text description."),
      assignee: z.string().optional().describe("Assignee name, email, or accountId. Resolved automatically."),
      priority: z.string().optional().describe("Priority name (e.g. 'High', 'Low')."),
      labels: z.array(z.string()).optional().describe("Labels to apply."),
      parentKey: z.string().optional().describe("Parent issue key (for subtasks or linking to an epic)."),
    },
    async (input) => {
      const jiraClient = await getJiraClient();

      if (!input.projectKey) throw new Error("projectKey is required.");
      if (!input.summary) throw new Error("summary is required.");
      if (!input.issueType) throw new Error("issueType is required.");

      // Resolve issue type
      const issuetype = await resolveIssueType(jiraClient, input.projectKey, input.issueType);

      // Build fields
      const fields = {
        project: { key: input.projectKey },
        summary: input.summary,
        issuetype,
      };
      if (input.description) fields.description = input.description;
      if (input.priority) fields.priority = { name: input.priority };
      if (input.labels && input.labels.length > 0) fields.labels = input.labels;
      if (input.parentKey) fields.parent = { key: input.parentKey };

      // Resolve assignee
      if (input.assignee) {
        const accountId = await resolveAssignee(jiraClient, input.assignee);
        if (accountId) fields.assignee = { accountId };
      }

      const created = await jiraClient.createIssue(fields);

      // Fetch the created issue with readable fields
      const issue = await jiraClient.getIssue(created.key, {
        fields: ["summary", "status", "assignee", "priority", "issuetype", "reporter", "created"],
      });

      const data = {
        key: issue.key,
        summary: issue.fields?.summary,
        status: issue.fields?.status?.name,
        issueType: issue.fields?.issuetype?.name,
        priority: issue.fields?.priority?.name,
        assignee: issue.fields?.assignee?.displayName || "Unassigned",
        created: issue.fields?.created,
      };

      return {
        content: [{ text: `Created ${data.key}: ${data.summary} [${data.issueType}/${data.status}] — ${data.assignee}`, type: "text" }],
        data: { success: true, issue: data },
      };
    },
  );
  registeredTools.push("createWorkItem");

  // ── 5. updateWorkItem ─────────────────────────────────────

  server.tool(
    "updateWorkItem",
    "Update a Jira issue in one call: transition status (by name), assign/unassign, add comment, update labels, priority, summary, or description. Returns the updated issue state and available next transitions.",
    {
      issueKey: z.string().describe("Issue key (e.g. 'ENG-123')."),
      status: z.string().optional().describe("Target status name (e.g. 'In Progress', 'Done'). Resolved to transition ID automatically."),
      assignee: z.string().optional().describe("Assignee name, email, or accountId. Use empty string to unassign."),
      comment: z.string().optional().describe("Comment text to add to the issue."),
      labels: z.array(z.string()).optional().describe("New labels to set (replaces existing)."),
      addLabels: z.array(z.string()).optional().describe("Labels to add (preserves existing)."),
      priority: z.string().optional().describe("Priority name (e.g. 'High', 'Low')."),
      summary: z.string().optional().describe("New summary/title."),
      description: z.string().optional().describe("New description (plain text)."),
    },
    async (input) => {
      const jiraClient = await getJiraClient();
      const { issueKey } = input;

      // Perform updates in sequence (some depend on issue state)
      const updates = [];

      // Transition status
      if (input.status) {
        const transitionId = await resolveTransition(jiraClient, issueKey, input.status);
        updates.push("transition");
        await jiraClient.doTransition(issueKey, transitionId, input.comment);
      }

      // Build field update
      const fields = {};
      if (input.summary !== undefined) fields.summary = input.summary;
      if (input.description !== undefined) fields.description = input.description;
      if (input.priority) fields.priority = { name: input.priority };

      // Assignee
      if (input.assignee !== undefined) {
        if (input.assignee === "") {
          fields.assignee = null;
        } else {
          const accountId = await resolveAssignee(jiraClient, input.assignee);
          if (accountId) fields.assignee = { accountId };
        }
      }

      // Labels: set or add
      if (input.labels) {
        fields.labels = input.labels;
      } else if (input.addLabels && input.addLabels.length > 0) {
        const issue = await jiraClient.getIssue(issueKey, { fields: ["labels"] });
        const existing = issue.fields?.labels || [];
        fields.labels = Array.from(new Set([...existing, ...input.addLabels]));
      }

      if (Object.keys(fields).length > 0) {
        updates.push("fields");
        await jiraClient.updateIssue(issueKey, fields);
      }

      // Add comment (if not already added via transition)
      if (input.comment && !input.status) {
        updates.push("comment");
        await jiraClient.addIssueComment(issueKey, input.comment);
      }

      // Fetch updated issue + available transitions
      const [issue, transitionsResp] = await Promise.all([
        jiraClient.getIssue(issueKey, {
          fields: ["summary", "status", "assignee", "priority", "issuetype", "labels", "updated"],
        }),
        jiraClient.getTransitions(issueKey).catch(() => ({ transitions: [] })),
      ]);

      const data = {
        key: issue.key,
        summary: issue.fields?.summary,
        status: issue.fields?.status?.name,
        statusCategory: issue.fields?.status?.statusCategory?.name,
        issueType: issue.fields?.issuetype?.name,
        priority: issue.fields?.priority?.name,
        assignee: issue.fields?.assignee?.displayName || "Unassigned",
        labels: issue.fields?.labels || [],
        updated: issue.fields?.updated,
        availableTransitions: transitionsResp.transitions.map((t) => ({
          id: t.id, name: t.name, targetStatus: t.to?.name,
        })),
      };

      const lines = [
        `Updated ${data.key}: ${data.summary}`,
        `Status: ${data.status} (${data.statusCategory})`,
        `Assignee: ${data.assignee}`,
        `Priority: ${data.priority}`,
        `Labels: ${data.labels.join(", ") || "none"}`,
        `Applied: ${updates.join(", ") || "no changes"}`,
        `Next transitions: ${data.availableTransitions.map((t) => t.targetStatus).join(", ") || "none"}`,
      ];

      return {
        content: [{ text: lines.join("\n"), type: "text" }],
        data: { success: true, issue: data, updates },
      };
    },
  );
  registeredTools.push("updateWorkItem");

  // ── 6. searchWorkItems ────────────────────────────────────

  server.tool(
    "searchWorkItems",
    "Search for Jira issues using structured filters — no JQL needed. Filter by project, status, assignee, issue type, priority, labels, sprint, or text. Advanced users can pass a raw JQL override.",
    {
      projectKey: z.string().optional().describe("Project key to search within."),
      status: z.union([z.string(), z.array(z.string())]).optional().describe("Status name(s) to filter by."),
      statusCategory: z.string().optional().describe("Status category: 'To Do', 'In Progress', or 'Done'."),
      assignee: z.string().optional().describe("Assignee name or accountId. Use 'currentUser' for self."),
      issueType: z.string().optional().describe("Issue type name (e.g. 'Bug', 'Task')."),
      priority: z.string().optional().describe("Priority name."),
      labels: z.array(z.string()).optional().describe("Labels to filter by (OR match)."),
      sprintId: z.number().optional().describe("Sprint ID to search within."),
      text: z.string().optional().describe("Text to search in summary/description."),
      updatedWithin: z.number().optional().describe("Only issues updated within last N days."),
      createdWithin: z.number().optional().describe("Only issues created within last N days."),
      jql: z.string().optional().describe("Raw JQL override (ignores other filters)."),
      maxResults: z.number().optional().describe("Max results (default 25)."),
    },
    async (input) => {
      const jiraClient = await getJiraClient();

      let jql = input.jql;
      if (!jql) {
        jql = buildJql(input);
        if (!jql) throw new Error("At least one filter is required, or provide raw jql.");
      }

      const results = await jiraClient.searchIssues(jql, {
        maxResults: input.maxResults ?? 25,
        fields: ["summary", "status", "assignee", "priority", "issuetype", "updated", "labels"],
      });

      const issues = (results.issues || []).map((i) => ({
        key: i.key,
        summary: i.fields?.summary,
        status: i.fields?.status?.name,
        statusCategory: i.fields?.status?.statusCategory?.name,
        issueType: i.fields?.issuetype?.name,
        priority: i.fields?.priority?.name,
        assignee: i.fields?.assignee?.displayName || "Unassigned",
        labels: i.fields?.labels || [],
        updated: i.fields?.updated,
      }));

      const lines = [
        `Found ${results.total || issues.length} issues matching: ${jql}`,
        ...issues.map((i) => `  ${i.key}: ${i.summary} [${i.issueType}/${i.status}/${i.priority}] — ${i.assignee}`),
      ];

      return {
        content: [{ text: lines.join("\n"), type: "text" }],
        data: { success: true, jql, total: results.total, issues },
      };
    },
  );
  registeredTools.push("searchWorkItems");

  // ── 7. getWorkItemDetails ─────────────────────────────────

  server.tool(
    "getWorkItemDetails",
    "Get full details of a Jira issue: description (as plain text), status, priority, assignee, reporter, subtasks with their statuses, recent comments, attachments, and available transitions (as status names).",
    {
      issueKey: z.string().describe("Issue key (e.g. 'ENG-123')."),
      commentLimit: z.number().optional().describe("Max comments to return (default 5)."),
    },
    async (input) => {
      const jiraClient = await getJiraClient();
      const { issueKey } = input;

      // Fetch issue, comments, and transitions in parallel
      const [issue, commentsPage, transitionsResp] = await Promise.all([
        jiraClient.getIssue(issueKey, {
          fields: [
            "summary", "description", "status", "priority", "assignee", "reporter",
            "issuetype", "labels", "created", "updated", "subtasks", "parent", "attachment",
          ],
        }),
        jiraClient.listIssueComments(issueKey, {
          orderBy: "created",
          maxResults: input.commentLimit ?? 5,
        }).catch(() => ({ comments: [] })),
        jiraClient.getTransitions(issueKey).catch(() => ({ transitions: [] })),
      ]);

      const f = issue.fields || {};
      const descriptionText = jiraClient.documentToPlainText(f.description) || "No description provided.";
      const subtasks = (f.subtasks || []).map((s) => ({
        key: s.key,
        summary: s.fields?.summary,
        status: s.fields?.status?.name,
      }));
      const comments = (commentsPage.comments || []).map((c) => ({
        id: c.id,
        author: c.author?.displayName || "Unknown",
        body: jiraClient.documentToPlainText(c.body) || "",
        created: c.created,
      }));
      const attachments = (f.attachment || []).map((a) => ({
        id: a.id,
        filename: a.filename,
        size: a.size,
        mimeType: a.mimeType,
      }));
      const transitions = transitionsResp.transitions.map((t) => ({
        id: t.id,
        name: t.name,
        targetStatus: t.to?.name,
      }));

      const data = {
        key: issue.key,
        summary: f.summary,
        status: f.status?.name,
        statusCategory: f.status?.statusCategory?.name,
        issueType: f.issuetype?.name,
        priority: f.priority?.name,
        assignee: f.assignee?.displayName || "Unassigned",
        reporter: f.reporter?.displayName || null,
        labels: f.labels || [],
        description: descriptionText,
        parent: f.parent?.key || null,
        subtasks,
        comments,
        attachments,
        availableTransitions: transitions,
        created: f.created,
        updated: f.updated,
      };

      const lines = [
        `${data.key}: ${data.summary}`,
        `Type: ${data.issueType} | Status: ${data.status} (${data.statusCategory}) | Priority: ${data.priority}`,
        `Assignee: ${data.assignee} | Reporter: ${data.reporter || "Unknown"}`,
        `Labels: ${data.labels.join(", ") || "none"}`,
        `Parent: ${data.parent || "none"}`,
        `\nDescription:\n${descriptionText}`,
      ];
      if (subtasks.length) {
        lines.push("\nSubtasks:");
        subtasks.forEach((s) => lines.push(`  ${s.key}: ${s.summary} [${s.status}]`));
      }
      if (comments.length) {
        lines.push("\nRecent comments:");
        comments.forEach((c) => lines.push(`  [${c.created}] ${c.author}: ${c.body.substring(0, 200)}`));
      }
      if (attachments.length) {
        lines.push("\nAttachments:");
        attachments.forEach((a) => lines.push(`  ${a.filename} (${a.size} bytes, ${a.mimeType || "unknown"})`));
      }
      if (transitions.length) {
        lines.push(`\nAvailable transitions: ${transitions.map((t) => t.targetStatus).join(", ")}`);
      }

      return {
        content: [{ text: lines.join("\n"), type: "text" }],
        data: { success: true, issue: data },
      };
    },
  );
  registeredTools.push("getWorkItemDetails");

  // ── 8. planSprint ─────────────────────────────────────────

  server.tool(
    "planSprint",
    "Create a new sprint and optionally move issues into it in one call. Returns the sprint summary with all issues.",
    {
      boardId: z.number().describe("Board ID to create the sprint on. Use getProjectOverview to find board IDs."),
      name: z.string().describe("Sprint name."),
      goal: z.string().optional().describe("Sprint goal."),
      startDate: z.string().optional().describe("Start date in ISO format (e.g. '2025-07-01T08:00:00.000Z'). Defaults to now."),
      endDate: z.string().optional().describe("End date in ISO format. Defaults to 2 weeks after start."),
      issueKeys: z.array(z.string()).optional().describe("Issue keys to move into the sprint."),
    },
    async (input) => {
      const jiraClient = await getJiraClient();

      if (!input.boardId) throw new Error("boardId is required.");
      if (!input.name) throw new Error("name is required.");

      const start = input.startDate || new Date().toISOString();
      const end = input.endDate || new Date(new Date(start).getTime() + 14 * 86400000).toISOString();

      const sprint = await jiraClient.createSprint({
        name: input.name,
        originBoardId: input.boardId,
        startDate: start,
        endDate: end,
        goal: input.goal,
      });

      // Move issues if provided
      if (input.issueKeys && input.issueKeys.length > 0) {
        await jiraClient.moveIssuesToSprint(sprint.id, input.issueKeys);
      }

      // Get all issues in the sprint
      const issues = await jiraClient.getIssuesForSprint(sprint.id).catch(() => []);
      const issueList = issues.map((i) => ({
        key: i.key,
        summary: i.fields?.summary,
        status: i.fields?.status?.name,
        assignee: i.fields?.assignee?.displayName || "Unassigned",
      }));

      const lines = [
        `Sprint created: ${sprint.name} (ID ${sprint.id})`,
        `Goal: ${sprint.goal || "(none)"}`,
        `Dates: ${start} → ${end}`,
        `Issues: ${issueList.length}`,
        ...issueList.map((i) => `  ${i.key}: ${i.summary} [${i.status}] — ${i.assignee}`),
      ];

      return {
        content: [{ text: lines.join("\n"), type: "text" }],
        data: { success: true, sprint: { id: sprint.id, name: sprint.name, goal: sprint.goal, startDate: start, endDate: end }, issues: issueList },
      };
    },
  );
  registeredTools.push("planSprint");

  // ── 9. completeSprintReport ───────────────────────────────

  server.tool(
    "completeSprintReport",
    "Complete an active sprint and get a report: completed vs incomplete issues, and suggestions for incomplete items.",
    {
      sprintId: z.number().describe("Sprint ID to complete. Must be in 'active' state."),
    },
    async (input) => {
      const jiraClient = await getJiraClient();

      if (!input.sprintId) throw new Error("sprintId is required.");

      // Get sprint info before completing
      const sprint = await jiraClient.getSprint(input.sprintId);
      if (sprint.state !== "active")
        throw new Error(`Sprint ${input.sprintId} ("${sprint.name}") is in '${sprint.state}' state. Only active sprints can be completed.`);

      // Get issues before completing
      const issues = await jiraClient.getIssuesForSprint(input.sprintId).catch(() => []);

      // Complete the sprint
      try {
        await jiraClient.completeSprint(input.sprintId);
      } catch (error) {
        return {
          content: [{ text: `Error completing sprint ${input.sprintId}: ${error.message}`, type: "text" }],
          isError: true,
        };
      }

      const completed = issues.filter((i) => i.fields?.status?.statusCategory?.name === "Done");
      const incomplete = issues.filter((i) => i.fields?.status?.statusCategory?.name !== "Done");

      const completedList = completed.map((i) => ({
        key: i.key,
        summary: i.fields?.summary,
        status: i.fields?.status?.name,
      }));
      const incompleteList = incomplete.map((i) => ({
        key: i.key,
        summary: i.fields?.summary,
        status: i.fields?.status?.name,
        assignee: i.fields?.assignee?.displayName || "Unassigned",
      }));

      const lines = [
        `Sprint "${sprint.name}" completed.`,
        `Goal: ${sprint.goal || "(none)"}`,
        `\n✅ Completed: ${completedList.length}/${issues.length}`,
        ...completedList.map((i) => `  ${i.key}: ${i.summary} [${i.status}]`),
        `\n❌ Incomplete: ${incompleteList.length}/${issues.length}`,
        ...incompleteList.map((i) => `  ${i.key}: ${i.summary} [${i.status}] — ${i.assignee}`),
      ];
      if (incompleteList.length > 0) {
        lines.push("\n💡 Suggestions:");
        lines.push("  - Move incomplete issues to the next sprint using manageBacklog.moveToSprint");
        lines.push("  - Or move them back to the backlog using manageBacklog.moveToBacklog");
      }

      return {
        content: [{ text: lines.join("\n"), type: "text" }],
        data: {
          success: true,
          sprint: { id: sprint.id, name: sprint.name, goal: sprint.goal },
          completed: completedList,
          incomplete: incompleteList,
          total: issues.length,
        },
      };
    },
  );
  registeredTools.push("completeSprintReport");

  // ── 10. findPeople ────────────────────────────────────────

  server.tool(
    "findPeople",
    "Find Jira users: search by name/email, or list project members (users with issues in a project). Returns accountId and displayName for use in other tools.",
    {
      command: z.enum(["search", "projectMembers", "/help"]).describe("The operation to perform."),
      query: z.string().optional().describe("Search query for 'search' (name, email, or username)."),
      projectKey: z.string().optional().describe("Project key for 'projectMembers'."),
      maxResults: z.number().optional().describe("Max results (default 10 for search, 50 for projectMembers)."),
    },
    async (input) => {
      if (input.command === "/help") {
        return {
          content: [{
            text: `findPeople commands:
- search: find users by name/email/username (requires query)
- projectMembers: list users with issues in a project (requires projectKey)`,
            type: "text",
          }],
        };
      }

      const jiraClient = await getJiraClient();

      switch (input.command) {
        case "search": {
          if (!input.query) throw new Error("search requires query.");
          const users = await jiraClient.searchUsers(input.query, input.maxResults ?? 10);
          if (!Array.isArray(users) || users.length === 0) {
            return {
              content: [{ text: `No users found matching "${input.query}".`, type: "text" }],
              data: { success: true, query: input.query, users: [] },
            };
          }
          const list = users.map((u) => ({
            accountId: u.accountId,
            displayName: u.displayName,
            email: u.emailAddress || null,
            active: u.active,
          }));
          return {
            content: [
              {
                text: `Found ${list.length} user(s):\n${list.map((u) => `- ${u.displayName} (${u.accountId})${u.email ? ` <${u.email}>` : ""}${u.active ? "" : " [inactive]"}`).join("\n")}`,
                type: "text",
              },
            ],
            data: { success: true, query: input.query, users: list },
          };
        }
        case "projectMembers": {
          if (!input.projectKey) throw new Error("projectMembers requires projectKey.");
          // Search for issues in the project and collect unique assignees
          const results = await jiraClient.searchIssues(
            `project = ${input.projectKey} AND assignee IS NOT EMPTY`,
            {
              maxResults: input.maxResults ?? 50,
              fields: ["assignee"],
            },
          );
          const usersMap = new Map();
          for (const issue of results.issues || []) {
            const a = issue.fields?.assignee;
            if (a && a.accountId && !usersMap.has(a.accountId)) {
              usersMap.set(a.accountId, {
                accountId: a.accountId,
                displayName: a.displayName,
                email: a.emailAddress || null,
                active: a.active !== false,
              });
            }
          }
          const list = Array.from(usersMap.values());
          return {
            content: [
              {
                text: list.length > 0
                  ? `Project ${input.projectKey} members (${list.length}):\n${list.map((u) => `- ${u.displayName} (${u.accountId})`).join("\n")}`
                  : `No members with assigned issues found in project ${input.projectKey}.`,
                type: "text",
              },
            ],
            data: { success: true, projectKey: input.projectKey, users: list },
          };
        }
        default:
          throw new Error(`Unknown command: ${input.command}`);
      }
    },
  );
  registeredTools.push("findPeople");

  console.log(`[TOOLS] Jira workflow tools registered: ${registeredTools.join(", ")}`);
  return registeredTools;
}
