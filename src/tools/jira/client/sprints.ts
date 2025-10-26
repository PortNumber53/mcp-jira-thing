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

  public async startSprint(
    sprintId: number,
    overrides: Partial<UpdateSprintPayload> = {},
  ): Promise<JiraSprint> {
    const current = await this.getSprint(sprintId);
    const startDate = overrides.startDate || current.startDate || new Date().toISOString();
    // Default end date to two weeks after start if not provided
    const endDate =
      overrides.endDate ||
      current.endDate ||
      new Date(new Date(startDate).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const payload: Partial<UpdateSprintPayload> = {
      name: overrides.name || current.name,
      state: 'active',
      startDate,
      endDate,
    };
    return this.updateSprint(sprintId, payload);
  }

  public async completeSprint(
    sprintId: number,
    overrides: Partial<UpdateSprintPayload> = {},
  ): Promise<JiraSprint> {
    const current = await this.getSprint(sprintId);
    const startDate = overrides.startDate || current.startDate || new Date().toISOString();
    const endDate = overrides.endDate || current.endDate || new Date().toISOString();
    const payload: Partial<UpdateSprintPayload> = {
      name: overrides.name || current.name,
      state: 'closed',
      startDate,
      endDate,
      completeDate: new Date().toISOString(),
    } as any;
    return this.updateSprint(sprintId, payload);
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
    await this.makeRequest<void>(`/rest/agile/1.0/backlog/issue?boardId=${encodeURIComponent(String(boardId))}`, 'POST', {
      issues: issueIdsOrKeys,
    });
  }
}
