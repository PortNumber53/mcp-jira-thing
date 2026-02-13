/**
 * Slack Integration Module
 *
 * Provides Slack connectivity for the platform, enabling users to
 * start and manage asynchronous tasks via Slack channels and messages.
 *
 * Feature flag: INTEGRATION_SLACK_ENABLED=true
 * Required env vars: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET
 */

import {
  IntegrationModule,
  IntegrationContext,
  IntegrationStatus,
  integrationRegistry,
} from "./registry";

interface SlackMessage {
  channel: string;
  text: string;
  thread_ts?: string;
  blocks?: SlackBlock[];
  [key: string]: unknown;
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text?: { type: string; text: string }; action_id?: string; value?: string }>;
}

interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  channel?: string;
  ts?: string;
  channels?: SlackChannel[];
}

export class SlackIntegration implements IntegrationModule {
  id = "slack";
  name = "Slack";
  featureFlag = "INTEGRATION_SLACK_ENABLED";
  requiredEnvVars = ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"];

  private botToken: string | null = null;
  private signingSecret: string | null = null;

  async initialize(ctx: IntegrationContext): Promise<void> {
    this.botToken = ctx.env.SLACK_BOT_TOKEN as string;
    this.signingSecret = ctx.env.SLACK_SIGNING_SECRET as string;

    // Verify the bot token works by calling auth.test
    const response = await this.apiCall("auth.test");
    if (!response.ok) {
      throw new Error(`Slack auth.test failed: ${response.error}`);
    }
    console.log(`[slack] Bot authenticated successfully`);
  }

  async getStatus(ctx: IntegrationContext): Promise<IntegrationStatus> {
    const flagValue = ctx.env[this.featureFlag];
    const enabled = flagValue === true || flagValue === "true" || flagValue === "1";
    const hasToken = !!ctx.env.SLACK_BOT_TOKEN;
    const hasSecret = !!ctx.env.SLACK_SIGNING_SECRET;

    return {
      id: this.id,
      name: this.name,
      enabled,
      configured: hasToken && hasSecret,
      error: !hasToken ? "SLACK_BOT_TOKEN not set" : !hasSecret ? "SLACK_SIGNING_SECRET not set" : undefined,
    };
  }

  async teardown(): Promise<void> {
    this.botToken = null;
    this.signingSecret = null;
  }

  // --- Public API ---

  /**
   * Send a message to a Slack channel.
   */
  async sendMessage(channel: string, text: string, options?: { threadTs?: string; blocks?: SlackBlock[] }): Promise<{ channel: string; ts: string }> {
    const payload: SlackMessage = { channel, text };
    if (options?.threadTs) payload.thread_ts = options.threadTs;
    if (options?.blocks) payload.blocks = options.blocks;

    const response = await this.apiCall("chat.postMessage", payload);
    if (!response.ok) {
      throw new Error(`Slack chat.postMessage failed: ${response.error}`);
    }
    return { channel: response.channel!, ts: response.ts! };
  }

  /**
   * List channels the bot has access to.
   */
  async listChannels(limit = 100): Promise<SlackChannel[]> {
    const response = await this.apiCall("conversations.list", {
      types: "public_channel,private_channel",
      limit,
      exclude_archived: true,
    });
    if (!response.ok) {
      throw new Error(`Slack conversations.list failed: ${response.error}`);
    }
    return response.channels ?? [];
  }

  /**
   * Post a task notification to a channel with action buttons.
   */
  async postTaskNotification(
    channel: string,
    taskKey: string,
    taskSummary: string,
    taskUrl: string,
  ): Promise<{ channel: string; ts: string }> {
    const blocks: SlackBlock[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${taskUrl}|${taskKey}>*: ${taskSummary}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View in Jira" },
            action_id: "view_jira_issue",
            value: taskKey,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Start Working" },
            action_id: "start_task",
            value: taskKey,
          },
        ],
      },
    ];

    return this.sendMessage(channel, `${taskKey}: ${taskSummary}`, { blocks });
  }

  /**
   * Verify a Slack webhook request signature.
   */
  async verifySignature(
    body: string,
    timestamp: string,
    signature: string,
  ): Promise<boolean> {
    if (!this.signingSecret) return false;

    const baseString = `v0:${timestamp}:${body}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(baseString));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `v0=${hex}` === signature;
  }

  // --- Private helpers ---

  private async apiCall(method: string, body?: Record<string, unknown>): Promise<SlackApiResponse> {
    if (!this.botToken) {
      throw new Error("Slack bot token not configured");
    }

    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Slack API HTTP error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<SlackApiResponse>;
  }
}

// Auto-register with the global registry
integrationRegistry.register(new SlackIntegration());
