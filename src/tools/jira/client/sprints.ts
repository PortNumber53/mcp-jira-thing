import { JiraClientCore } from './core';
import { JiraSprint, CreateSprintPayload, UpdateSprintPayload, JiraIssue } from '../interfaces';

export class JiraSprints extends JiraClientCore {
  public async createSprint(payload: CreateSprintPayload): Promise<JiraSprint> {
    return this.makeRequest<JiraSprint>('/rest/agile/1.0/sprint', 'POST', payload);
  }

  public async getSprint(sprintId: number): Promise<JiraSprint> {
    return this.makeRequest<JiraSprint>(`/rest/agile/1.0/sprint/${sprintId}`);
  }

  public async updateSprint(sprintId: number, payload: Partial<UpdateSprintPayload>): Promise<JiraSprint> {
    return this.makeRequest<JiraSprint>(`/rest/agile/1.0/sprint/${sprintId}`, 'PUT', payload);
  }

  public async deleteSprint(sprintId: number): Promise<void> {
    return this.makeRequest<void>(`/rest/agile/1.0/sprint/${sprintId}`, 'DELETE');
  }

  public async startSprint(sprintId: number): Promise<JiraSprint> {
    return this.updateSprint(sprintId, { state: 'active', startDate: new Date().toISOString() });
  }

  public async completeSprint(sprintId: number): Promise<JiraSprint> {
    return this.updateSprint(sprintId, { state: 'closed', completeDate: new Date().toISOString() });
  }

  public async getSprintsForBoard(boardId: number): Promise<JiraSprint[]> {
    const response = await this.makeRequest<{ values: JiraSprint[] }>(`/rest/agile/1.0/board/${boardId}/sprint`);
    return response.values;
  }

  public async getIssuesForSprint(sprintId: number): Promise<JiraIssue[]> {
    const response = await this.makeRequest<{ issues: JiraIssue[] }>(`/rest/agile/1.0/sprint/${sprintId}/issue`);
    return response.issues;
  }

  public async moveIssuesToSprint(sprintId: number, issueIdsOrKeys: string[]): Promise<void> {
    await this.makeRequest<void>(`/rest/agile/1.0/sprint/${sprintId}/issue`, 'POST', { issues: issueIdsOrKeys });
  }

  public async moveIssuesToBacklog(boardId: number, issueIdsOrKeys: string[]): Promise<void> {
    await this.makeRequest<void>(`/rest/agile/1.0/backlog/issue`, 'POST', { issues: issueIdsOrKeys, boardId: boardId });
  }
}
