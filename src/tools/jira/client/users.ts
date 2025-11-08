import { JiraClientCore } from './core';
import { JiraUser, CreateUserPayload } from '../interfaces';

export class JiraUsers extends JiraClientCore {
  public async getUsers(): Promise<JiraUser[]> {
    // Jira Cloud: /rest/api/3/users/search returns all users visible to the calling user
    return this.makeRequest<JiraUser[]>(`/rest/api/3/users/search`);
  }
  public async getUser(accountId: string): Promise<JiraUser> {
    const url = `/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`;
    console.log("[jira] getUser: fetching", { url });
    return this.makeRequest<JiraUser>(url);
  }

  public async createUser(payload: CreateUserPayload): Promise<JiraUser> {
    const url = `/rest/api/3/user`;
    console.log("[jira] createUser: creating user", {
      url,
      hasEmail: !!payload.emailAddress,
      hasDisplayName: !!payload.displayName,
    });
    return this.makeRequest<JiraUser>('POST', url, payload);
  }

  public async deleteUser(accountId: string): Promise<void> {
    const url = `/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`;
    console.log("[jira] deleteUser: deleting user", { url });
    await this.makeRequest<void>('DELETE', url);
  }
}
