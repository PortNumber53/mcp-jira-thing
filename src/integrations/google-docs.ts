/**
 * Google Docs Integration Module
 *
 * Allows users to connect documents from their Google Docs account,
 * so their content can be read and modified through the platform.
 *
 * Feature flag: INTEGRATION_GOOGLE_DOCS_ENABLED=true
 * Required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */

import {
  IntegrationModule,
  IntegrationContext,
  IntegrationStatus,
  integrationRegistry,
} from "./registry";

interface GoogleDocsDocument {
  documentId: string;
  title: string;
  revisionId?: string;
  body?: GoogleDocsBody;
}

interface GoogleDocsBody {
  content: GoogleDocsStructuralElement[];
}

interface GoogleDocsStructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: {
    elements: GoogleDocsParagraphElement[];
  };
  sectionBreak?: Record<string, unknown>;
  table?: Record<string, unknown>;
}

interface GoogleDocsParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: {
    content: string;
    textStyle?: Record<string, unknown>;
  };
}

interface GoogleDocsListResponse {
  files: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    webViewLink: string;
  }>;
  nextPageToken?: string;
}

export class GoogleDocsIntegration implements IntegrationModule {
  id = "google_docs";
  name = "Google Docs";
  featureFlag = "INTEGRATION_GOOGLE_DOCS_ENABLED";
  requiredEnvVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

  private clientId: string | null = null;
  private clientSecret: string | null = null;

  async initialize(ctx: IntegrationContext): Promise<void> {
    this.clientId = ctx.env.GOOGLE_CLIENT_ID as string;
    this.clientSecret = ctx.env.GOOGLE_CLIENT_SECRET as string;
    console.log(`[google-docs] Integration initialized`);
  }

  async getStatus(ctx: IntegrationContext): Promise<IntegrationStatus> {
    const flagValue = ctx.env[this.featureFlag];
    const enabled = flagValue === true || flagValue === "true" || flagValue === "1";
    const hasClientId = !!ctx.env.GOOGLE_CLIENT_ID;
    const hasClientSecret = !!ctx.env.GOOGLE_CLIENT_SECRET;

    return {
      id: this.id,
      name: this.name,
      enabled,
      configured: hasClientId && hasClientSecret,
      error: !hasClientId
        ? "GOOGLE_CLIENT_ID not set"
        : !hasClientSecret
          ? "GOOGLE_CLIENT_SECRET not set"
          : undefined,
    };
  }

  async teardown(): Promise<void> {
    this.clientId = null;
    this.clientSecret = null;
  }

  // --- Public API ---

  /**
   * Get the content of a Google Doc by its document ID.
   * Requires a valid user access token obtained via OAuth.
   */
  async getDocument(accessToken: string, documentId: string): Promise<GoogleDocsDocument> {
    const response = await this.apiCall(
      accessToken,
      `https://docs.googleapis.com/v1/documents/${documentId}`,
    );
    return response as GoogleDocsDocument;
  }

  /**
   * Extract plain text content from a Google Doc.
   */
  async getDocumentText(accessToken: string, documentId: string): Promise<string> {
    const doc = await this.getDocument(accessToken, documentId);
    return this.extractPlainText(doc);
  }

  /**
   * List Google Docs accessible to the user.
   * Uses the Google Drive API to find documents with mimeType application/vnd.google-apps.document.
   */
  async listDocuments(
    accessToken: string,
    options?: { query?: string; pageSize?: number; pageToken?: string },
  ): Promise<GoogleDocsListResponse> {
    const params = new URLSearchParams();
    const mimeFilter = "mimeType='application/vnd.google-apps.document'";
    const nameFilter = options?.query ? ` and name contains '${options.query.replace(/'/g, "\\'")}'` : "";
    params.set("q", `${mimeFilter}${nameFilter}`);
    params.set("fields", "files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken");
    params.set("pageSize", String(options?.pageSize ?? 20));
    params.set("orderBy", "modifiedTime desc");
    if (options?.pageToken) params.set("pageToken", options.pageToken);

    const response = await this.apiCall(
      accessToken,
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    );
    return response as GoogleDocsListResponse;
  }

  /**
   * Insert text at the end of a Google Doc.
   */
  async appendText(accessToken: string, documentId: string, text: string): Promise<void> {
    // First get the document to find the end index
    const doc = await this.getDocument(accessToken, documentId);
    const body = doc.body;
    if (!body || !body.content || body.content.length === 0) {
      throw new Error("Document body is empty or inaccessible");
    }

    const lastElement = body.content[body.content.length - 1];
    const endIndex = (lastElement.endIndex ?? 1) - 1;

    const requests = [
      {
        insertText: {
          location: { index: Math.max(endIndex, 1) },
          text,
        },
      },
    ];

    await this.batchUpdate(accessToken, documentId, requests);
  }

  /**
   * Replace all occurrences of a substring in a Google Doc.
   */
  async replaceText(
    accessToken: string,
    documentId: string,
    searchText: string,
    replaceText: string,
  ): Promise<{ occurrencesChanged: number }> {
    const requests = [
      {
        replaceAllText: {
          containsText: {
            text: searchText,
            matchCase: true,
          },
          replaceText,
        },
      },
    ];

    const result = await this.batchUpdate(accessToken, documentId, requests);
    const reply = result.replies?.[0]?.replaceAllText;
    return { occurrencesChanged: reply?.occurrencesChanged ?? 0 };
  }

  // --- Private helpers ---

  private extractPlainText(doc: GoogleDocsDocument): string {
    if (!doc.body?.content) return "";

    const parts: string[] = [];
    for (const element of doc.body.content) {
      if (element.paragraph?.elements) {
        for (const pe of element.paragraph.elements) {
          if (pe.textRun?.content) {
            parts.push(pe.textRun.content);
          }
        }
      }
    }
    return parts.join("");
  }

  private async batchUpdate(
    accessToken: string,
    documentId: string,
    requests: Record<string, unknown>[],
  ): Promise<{ replies?: Array<Record<string, any>> }> {
    const response = await fetch(
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Docs batchUpdate failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<{ replies?: Array<Record<string, any>> }>;
  }

  private async apiCall(accessToken: string, url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google API error: ${response.status} ${text}`);
    }

    return response.json();
  }
}

// Auto-register with the global registry
integrationRegistry.register(new GoogleDocsIntegration());
