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
  // Add other common fields as needed
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
  // ... other properties from Jira issue response
}

export interface JiraIssueSearchResult {
  expand: string;
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

export interface CreateUserPayload {
  emailAddress: string;
  displayName?: string;
  password?: string;
  notification?: boolean;
}

export interface JiraUser {
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
  state: 'future' | 'active' | 'closed';
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
  state?: 'future' | 'active' | 'closed';
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
