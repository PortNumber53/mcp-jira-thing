import { JiraClientCore } from './core';
import { JiraIssueFields, JiraIssue, JiraIssueSearchResult } from '../interfaces';

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

  public async getTransitions(issueIdOrKey: string): Promise<JiraTransitionsResponse> {
    return this.makeRequest<JiraTransitionsResponse>(`/rest/api/3/issue/${issueIdOrKey}/transitions`);
  }

  public async doTransition(issueIdOrKey: string, transitionId: string, comment?: string): Promise<void> {
    const payload: any = {
      transition: { id: transitionId }
    };
    
    if (comment) {
      payload.update = {
        comment: [
          {
            add: {
              body: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: comment
                      }
                    ]
                  }
                ]
              }
            }
          }
        ]
      };
    }
    
    return this.makeRequest<void>(`/rest/api/3/issue/${issueIdOrKey}/transitions`, 'POST', payload);
  }
}
