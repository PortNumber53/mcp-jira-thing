import { z } from "zod";

export const JiraProjectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  projectTypeKey: z.string(),
  simplified: z.boolean(),
  description: z.string().optional().nullable(),
  lead: z.object({
    accountId: z.string(),
    displayName: z.string(),
    active: z.boolean(),
    self: z.string(),
  }).optional().nullable(),
  avatarUrls: z.object({
    "16x16": z.string(),
    "24x24": z.string(),
    "32x32": z.string(),
    "48x48": z.string(),
  }),
});

export interface JiraIssueFields {
  project: { key: string };
  summary: string;
  issuetype: { name: string; id?: string };
  description?: {
    type: string;
    version: number;
    content: Array<any>;
  };
  parent?: { key: string }; // For subtasks
  labels?: string[]; // For tags
  status?: {
    id: string;
    name: string;
    statusCategory?: {
      id: number;
      key: string;
      name: string;
    };
  };
  priority?: {
    id: string;
    name: string;
  };
  assignee?: {
    accountId: string;
    displayName: string;
  } | null;
  reporter?: {
    accountId: string;
    displayName: string;
  } | null;
  created?: string;
  updated?: string;
  // Add other common fields as needed
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
  // ... other properties from Jira issue response
}

export type JiraDocument = {
  type: "doc";
  version: number;
  content: Array<any>;
};

export interface JiraIssueSearchResult {
  expand: string;
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

export interface JiraComment {
  id: string;
  self: string;
  body: JiraDocument;
  renderedBody?: string;
  author?: {
    accountId: string;
    displayName: string;
  };
  updateAuthor?: {
    accountId: string;
    displayName: string;
  };
  visibility?: {
    type: "group" | "role";
    value?: string;
    identifier?: string;
  };
  created: string;
  updated: string;
}

export interface JiraCommentPage {
  comments: JiraComment[];
  maxResults?: number;
  total?: number;
  startAt?: number;
}

// PageBean returned by POST /rest/api/3/comment/list
export interface JiraCommentPageBean {
  isLast: boolean;
  maxResults: number;
  startAt: number;
  total: number;
  values: JiraComment[];
}

// Options for listing comments on an issue
export interface JiraCommentListOptions {
  startAt?: number;
  maxResults?: number;
  orderBy?: string; // created | updated (Jira may accept other forms like createdDate)
  expand?: string | string[];
}

// Extra properties when creating/updating a comment
export interface JiraCommentWriteOptions {
  visibility?: {
    type: "group" | "role";
    value?: string;
    identifier?: string;
  };
  properties?: any[];
  // update-specific query flags
  notifyUsers?: boolean;
  overrideEditableFlag?: boolean;
  expand?: string | string[];
}

export interface JiraAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType?: string;
  content: string;
  thumbnail?: string;
}

export interface JiraPriority {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  statusColor?: string;
}

export interface JiraIssueType {
  self: string;
  id: string;
  description: string;
  iconUrl: string;
  name: string;
  subtask: boolean;
  avatarId: number;
  hierarchyLevel: number;
  scope?: {
    type: string;
    project?: {
      id: string;
      key: string;
      name: string;
    };
  };
}

export interface CreateIssueTypePayload {
  name: string;
  description?: string;
  type?: "standard" | "subtask";
  hierarchyLevel?: number;
}

export interface UpdateIssueTypePayload {
  name?: string;
  description?: string;
  avatarId?: number;
}

export interface CreateUserPayload {
  emailAddress: string;
  displayName?: string;
  password?: string;
  notification?: boolean;
}

export interface JiraUser {
  // Already present, just ensuring export

  accountId: string;
  accountType: string;
  active: boolean;
  avatarUrls: {
    "16x16": string;
    "24x24": string;
    "32x32": string;
    "48x48": string;
  };
  displayName: string;
  emailAddress?: string; // Optional as it might be blank for deleted users
  self: string;
  timeZone?: string;
}

export interface JiraSprint {
  id: number;
  self: string;
  state: "future" | "active" | "closed";
  name: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId: number;
  goal?: string;
}

export interface CreateSprintPayload {
  name: string;
  startDate: string;
  endDate: string;
  originBoardId: number;
  goal?: string;
}

export interface UpdateSprintPayload {
  id: number;
  name?: string;
  startDate?: string;
  endDate?: string;
  state?: "future" | "active" | "closed";
  goal?: string;
  completeDate?: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  simplified: boolean;
  description?: string;
  lead?: {
    accountId: string;
    displayName: string;
    active: boolean;
    self: string;
  };
  avatarUrls: {
    "16x16": string;
    "24x24": string;
    "32x32": string;
    "48x48": string;
  };
}
