import { JiraClientCore } from "./core";
import {
  JiraIssueFields,
  JiraIssue,
  JiraIssueSearchResult,
  JiraCommentPage,
  JiraComment,
  JiraAttachment,
  JiraDocument,
} from "../interfaces";

export interface JiraGetIssueOptions {
  fields?: string | string[];
  expand?: string | string[];
  properties?: string | string[];
  fieldsByKeys?: boolean;
  updateHistory?: boolean;
}

export interface JiraSearchIssuesOptions {
  maxResults?: number;
  startAt?: number;
  fields?: string | string[];
  expand?: string | string[];
  properties?: string | string[];
  fieldsByKeys?: boolean;
}

function normalizeList(value?: string | string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item) && item.length > 0)
      .join(",");
  }
  return value;
}

interface JiraTransition {
  id: string;
  name: string;
  to: {
    self: string;
    description: string;
    iconUrl: string;
    name: string;
    id: string;
    statusCategory: {
      self: string;
      id: number;
      key: string;
      colorName: string;
      name: string;
    };
  };
}

interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

export class JiraIssues extends JiraClientCore {
  public async createIssue(fields: JiraIssueFields): Promise<JiraIssue> {
    return this.makeRequest<JiraIssue>("/rest/api/3/issue", "POST", { fields });
  }

  public async getIssue(issueIdOrKey: string, options: JiraGetIssueOptions = {}): Promise<JiraIssue> {
    const params = new URLSearchParams();
    const fields = normalizeList(options.fields);
    const expand = normalizeList(options.expand);
    const properties = normalizeList(options.properties);

    if (fields) params.set("fields", fields);
    if (expand) params.set("expand", expand);
    if (properties) params.set("properties", properties);
    if (options.fieldsByKeys !== undefined) params.set("fieldsByKeys", String(options.fieldsByKeys));
    if (options.updateHistory !== undefined) params.set("updateHistory", String(options.updateHistory));

    const query = params.toString();
    const suffix = query ? `?${query}` : "";

    return this.makeRequest<JiraIssue>(`/rest/api/3/issue/${issueIdOrKey}${suffix}`);
  }

  public async updateIssue(issueIdOrKey: string, fields: Partial<JiraIssueFields>): Promise<void> {
    return this.makeRequest<void>(`/rest/api/3/issue/${issueIdOrKey}`, "PUT", { fields });
  }

  public async deleteIssue(issueIdOrKey: string): Promise<void> {
    return this.makeRequest<void>(`/rest/api/3/issue/${issueIdOrKey}`, "DELETE");
  }

  public async searchIssues(jql: string, options: JiraSearchIssuesOptions = {}): Promise<JiraIssueSearchResult> {
    const params = new URLSearchParams();
    const fields = normalizeList(options.fields);
    const expand = normalizeList(options.expand);
    const properties = normalizeList(options.properties);

    params.set("jql", jql);
    params.set("maxResults", String(options.maxResults ?? 50));

    if (options.startAt !== undefined) params.set("startAt", String(options.startAt));
    if (fields) params.set("fields", fields);
    if (expand) params.set("expand", expand);
    if (properties) params.set("properties", properties);
    if (options.fieldsByKeys !== undefined) params.set("fieldsByKeys", String(options.fieldsByKeys));

    return this.makeRequest<JiraIssueSearchResult>(`/rest/api/3/search?${params.toString()}`);
  }

  public async getTransitions(issueIdOrKey: string): Promise<JiraTransitionsResponse> {
    return this.makeRequest<JiraTransitionsResponse>(`/rest/api/3/issue/${issueIdOrKey}/transitions`);
  }

  public async doTransition(issueIdOrKey: string, transitionId: string, comment?: string): Promise<void> {
    const payload: any = {
      transition: { id: transitionId },
    };

    if (comment) {
      payload.update = {
        comment: [
          {
            add: {
              body: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: comment,
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      };
    }

    return this.makeRequest<void>(`/rest/api/3/issue/${issueIdOrKey}/transitions`, "POST", payload);
  }

  public async listComments(issueIdOrKey: string): Promise<JiraCommentPage> {
    return this.makeRequest<JiraCommentPage>(`/rest/api/3/issue/${issueIdOrKey}/comment`);
  }

  public async addComment(issueIdOrKey: string, body: JiraDocument): Promise<JiraComment> {
    return this.makeRequest<JiraComment>(`/rest/api/3/issue/${issueIdOrKey}/comment`, "POST", { body });
  }

  public async updateComment(issueIdOrKey: string, commentId: string, body: JiraDocument): Promise<JiraComment> {
    return this.makeRequest<JiraComment>(`/rest/api/3/issue/${issueIdOrKey}/comment/${commentId}`, "PUT", { body });
  }

  public async deleteComment(issueIdOrKey: string, commentId: string): Promise<void> {
    return this.makeRequest<void>(`/rest/api/3/issue/${issueIdOrKey}/comment/${commentId}`, "DELETE");
  }

  public async getAttachments(issueIdOrKey: string): Promise<JiraAttachment[]> {
    const response = await this.makeRequest<{ fields: { attachment?: JiraAttachment[] } }>(
      `/rest/api/3/issue/${issueIdOrKey}?fields=attachment`,
    );
    return response.fields?.attachment || [];
  }

  public async addAttachment(
    issueIdOrKey: string,
    file: { filename: string; data: ArrayBuffer; contentType?: string },
  ): Promise<JiraAttachment[]> {
    const formData = new FormData();
    const blob = new Blob([file.data], { type: file.contentType || "application/octet-stream" });
    formData.append("file", blob, file.filename);

    return this.makeRequest<JiraAttachment[]>(`/rest/api/3/issue/${issueIdOrKey}/attachments`, "POST", undefined, {
      headers: {
        "X-Atlassian-Token": "no-check",
      },
      rawBody: formData,
    });
  }

  public async deleteAttachment(attachmentId: string): Promise<void> {
    return this.makeRequest<void>(`/rest/api/3/attachment/${attachmentId}`, "DELETE");
  }
}
