import { JiraClientCore } from './core';
import { JiraIssueFields, JiraIssue, JiraIssueSearchResult } from '../interfaces';

export class JiraIssues extends JiraClientCore {
  public async createIssue(fields: JiraIssueFields): Promise<JiraIssue> {
    return this.makeRequest<JiraIssue>('/rest/api/3/issue', 'POST', { fields });
  }

  public async getIssue(issueIdOrKey: string): Promise<JiraIssue> {
    return this.makeRequest<JiraIssue>(`/rest/api/3/issue/${issueIdOrKey}`);
  }

  public async updateIssue(issueIdOrKey: string, fields: Partial<JiraIssueFields>): Promise<void> {
    return this.makeRequest<void>(`/rest/api/3/issue/${issueIdOrKey}`, 'PUT', { fields });
  }

  public async deleteIssue(issueIdOrKey: string): Promise<void> {
    return this.makeRequest<void>(`/rest/api/3/issue/${issueIdOrKey}`, 'DELETE');
  }

  public async searchIssues(jql: string, maxResults: number = 50): Promise<JiraIssueSearchResult> {
    return this.makeRequest<JiraIssueSearchResult>(`/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`);
  }
}
