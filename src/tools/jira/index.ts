import { JiraIssueFields, JiraIssue, JiraIssueSearchResult, CreateUserPayload, JiraUser, JiraSprint, CreateSprintPayload, UpdateSprintPayload } from './interfaces';
import { JiraClientCore } from './client/core';
import { JiraIssues } from './client/issues';
import { JiraSprints } from './client/sprints';
import { JiraProjects, JiraProjectCreatePayload } from './client/projects';
import { JiraUsers } from './client/users';
import { JiraProject } from './interfaces';
import { parseLabels } from './utils';

export class JiraClient extends JiraClientCore {
  private issues: JiraIssues;
  private sprints: JiraSprints;
  private projects: JiraProjects;
  private users: JiraUsers;

  constructor(env: Env) {
    super(env);
    this.issues = new JiraIssues(env);
    this.sprints = new JiraSprints(env);
    this.projects = new JiraProjects(env);
    this.users = new JiraUsers(env);
  }

  // Epic CRUD operations
  public async createEpic(projectKey: string, summary: string, description?: string): Promise<JiraIssue> {
    const fields: JiraIssueFields = {
      project: { key: projectKey },
      summary: summary,
      issuetype: { name: 'Epic' }, // Assuming 'Epic' is the issue type name for Epics
      description: description ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] } : undefined,
    };
    return this.issues.createIssue(fields);
  }

  public async getEpic(issueIdOrKey: string): Promise<JiraIssue> {
    return this.issues.getIssue(issueIdOrKey);
  }

  public async getProjects(): Promise<JiraProject[]> {
    console.log('inside getProjects function');
    return this.projects.getProjects();
  }

  public async updateEpic(issueIdOrKey: string, summary?: string, description?: string): Promise<void> {
    const fields: Partial<JiraIssueFields> = {};
    if (summary) fields.summary = summary;
    if (description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] };
    return this.issues.updateIssue(issueIdOrKey, fields);
  }

  public async deleteEpic(issueIdOrKey: string): Promise<void> {
    return this.issues.deleteIssue(issueIdOrKey);
  }

  // Task CRUD operations
  public async createTask(projectKey: string, summary: string, description?: string): Promise<JiraIssue> {
    const fields: JiraIssueFields = {
      project: { key: projectKey },
      summary: summary,
      issuetype: { name: 'Task' }, // Assuming 'Task' is the issue type name for Tasks
      description: description ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] } : undefined,
    };
    return this.issues.createIssue(fields);
  }

  public async getTask(issueIdOrKey: string): Promise<JiraIssue> {
    return this.issues.getIssue(issueIdOrKey);
  }

  public async updateTask(issueIdOrKey: string, summary?: string, description?: string): Promise<void> {
    const fields: Partial<JiraIssueFields> = {};
    if (summary) fields.summary = summary;
    if (description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] };
    return this.issues.updateIssue(issueIdOrKey, fields);
  }

  public async deleteTask(issueIdOrKey: string): Promise<void> {
    return this.issues.deleteIssue(issueIdOrKey);
  }

  // Subtask CRUD operations
  public async createSubtask(parentIssueKey: string, projectKey: string, summary: string, description?: string): Promise<JiraIssue> {
    const fields: JiraIssueFields = {
      project: { key: projectKey },
      summary: summary,
      issuetype: { name: 'Subtask' }, // Assuming 'Subtask' is the issue type name for Subtasks
      parent: { key: parentIssueKey },
      description: description ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] } : undefined,
    };
    return this.issues.createIssue(fields);
  }

  public async getSubtask(issueIdOrKey: string): Promise<JiraIssue> {
    return this.issues.getIssue(issueIdOrKey);
  }

  public async updateSubtask(issueIdOrKey: string, summary?: string, description?: string): Promise<void> {
    const fields: Partial<JiraIssueFields> = {};
    if (summary) fields.summary = summary;
    if (description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] };
    return this.issues.updateIssue(issueIdOrKey, fields);
  }

  public async deleteSubtask(issueIdOrKey: string): Promise<void> {
    return this.issues.deleteIssue(issueIdOrKey);
  }

  // Label (Tag) management operations
  public async addLabels(issueIdOrKey: string, labelsToAdd: string[]): Promise<void> {
    // Parse and sanitize labels to ensure we're not adding brackets or quotes
    const sanitizedLabels = parseLabels(labelsToAdd);
    
    const issue = await this.issues.getIssue(issueIdOrKey);
    const currentLabels = issue.fields.labels || [];
    const newLabels = Array.from(new Set([...currentLabels, ...sanitizedLabels]));
    return this.issues.updateIssue(issueIdOrKey, { labels: newLabels });
  }

  public async removeLabels(issueIdOrKey: string, labelsToRemove: string[]): Promise<void> {
    // Parse and sanitize labels to ensure we're removing the right labels
    const sanitizedLabels = parseLabels(labelsToRemove);
    
    const issue = await this.issues.getIssue(issueIdOrKey);
    const currentLabels = issue.fields.labels || [];
    const newLabels = currentLabels.filter(label => !sanitizedLabels.includes(label));
    return this.issues.updateIssue(issueIdOrKey, { labels: newLabels });
  }

  public async getLabelsForIssue(issueIdOrKey: string): Promise<string[]> {
    const issue = await this.issues.getIssue(issueIdOrKey);
    return issue.fields.labels || [];
  }

  public async setLabels(issueIdOrKey: string, labels: string[]): Promise<void> {
    // Parse and sanitize labels to ensure we're setting the right labels
    const sanitizedLabels = parseLabels(labels);
    return this.issues.updateIssue(issueIdOrKey, { labels: sanitizedLabels });
  }

  // User management operations
  public async getUser(accountId: string): Promise<JiraUser> {
    return this.users.getUser(accountId);
  }

  public async createUser(payload: CreateUserPayload): Promise<JiraUser> {
    return this.users.createUser(payload);
  }

  public async deleteUser(accountId: string): Promise<void> {
    return this.users.deleteUser(accountId);
  }

  // Sprint management operations
  public async createSprint(payload: CreateSprintPayload): Promise<JiraSprint> {
    return this.sprints.createSprint(payload);
  }

  public async getSprint(sprintId: number): Promise<JiraSprint> {
    return this.sprints.getSprint(sprintId);
  }

  public async updateSprint(sprintId: number, payload: Partial<UpdateSprintPayload>): Promise<JiraSprint> {
    return this.sprints.updateSprint(sprintId, payload);
  }

  public async searchIssues(jql: string, maxResults: number = 50): Promise<JiraIssueSearchResult> {
    return this.issues.searchIssues(jql, maxResults);
  }

  public async deleteSprint(sprintId: number): Promise<void> {
    return this.sprints.deleteSprint(sprintId);
  }

  public async startSprint(sprintId: number): Promise<JiraSprint> {
    return this.sprints.startSprint(sprintId);
  }

  public async completeSprint(sprintId: number): Promise<JiraSprint> {
    return this.sprints.completeSprint(sprintId);
  }

  public async getSprintsForBoard(boardId: number): Promise<JiraSprint[]> {
    return this.sprints.getSprintsForBoard(boardId);
  }

  public async getIssuesForSprint(sprintId: number): Promise<JiraIssue[]> {
    return this.sprints.getIssuesForSprint(sprintId);
  }

  public async moveIssuesToSprint(sprintId: number, issueIdsOrKeys: string[]): Promise<void> {
    return this.sprints.moveIssuesToSprint(sprintId, issueIdsOrKeys);
  }

  public async moveIssuesToBacklog(boardId: number, issueIdsOrKeys: string[]): Promise<void> {
    return this.sprints.moveIssuesToBacklog(boardId, issueIdsOrKeys);
  }

  // Project management operations
  public async createProject(payload: JiraProjectCreatePayload): Promise<JiraProject> {
    return this.projects.createProject(payload);
  }

  public async getProject(projectIdOrKey: string, expand?: string): Promise<JiraProject> {
    return this.projects.getProject(projectIdOrKey, expand);
  }

  /**
   * Search for Jira users by query string
   * @param query Search query (username, display name, or email)
   * @returns Array of user objects with account IDs
   */
  public async searchUsers(query: string): Promise<any[]> {
    return this.makeRequest<any[]>(`/rest/api/3/user/search?query=${encodeURIComponent(query)}`, 'GET');
  }
}
