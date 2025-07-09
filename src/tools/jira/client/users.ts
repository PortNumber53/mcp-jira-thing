import { JiraClientCore } from './core';
import { JiraUser, CreateUserPayload } from '../interfaces';

export class JiraUsers extends JiraClientCore {
  public async getUsers(): Promise<JiraUser[]> {
    // Jira Cloud: /rest/api/3/users/search returns all users visible to the calling user
    return this.makeRequest<JiraUser[]>(`/rest/api/3/users/search`);
  }
  public async getUser(accountId: string): Promise<JiraUser> {
    return this.makeRequest<JiraUser>(`rest/api/3/user?accountId=${accountId}`);
  }

  public async createUser(payload: CreateUserPayload): Promise<JiraUser> {
    return this.makeRequest<JiraUser>('POST', 'rest/api/3/user', payload);
  }

  public async deleteUser(accountId: string): Promise<void> {
    await this.makeRequest<void>('DELETE', `rest/api/3/user?accountId=${accountId}`);
  }
}
