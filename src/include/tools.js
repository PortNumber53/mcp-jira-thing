import { Octokit } from "octokit";
import { z } from "zod";
import { registerJiraWorkflowTools } from "./jira-workflow-tools";

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

  // ── Jira workflow tools (replaces old per-endpoint tools) ──
  const jiraTools = await registerJiraWorkflowTools(server, getJiraClient, {
    stripAvatarUrls,
    normalizeUser,
    normalizeResponse,
  });
  registeredTools.push(...jiraTools);

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

