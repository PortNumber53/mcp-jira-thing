export class JiraClientCore {
  protected apiKey: string;
  protected baseUrl: string;
  protected email: string;

  constructor(env: Env) {
    this.apiKey = env.ATLASSIAN_API_KEY;
    this.baseUrl = env.JIRA_BASE_URL;
    this.email = env.JIRA_EMAIL;

    if (!this.apiKey) {
      throw new Error('ATLASSIAN_API_KEY environment variable is not set.');
    }
    if (!this.baseUrl) {
      throw new Error('JIRA_BASE_URL environment variable is not set.');
    }
    if (!this.email) {
      throw new Error('JIRA_EMAIL environment variable is not set.');
    }
  }

  protected async makeRequest<T>(endpoint: string, method: string = 'GET', data?: any): Promise<T> {
    const auth = `Basic ${btoa(`${this.email}:${this.apiKey}`)}`;

    const headers: HeadersInit = {
      'Authorization': auth,
      'Accept': 'application/json',
    };

    const requestOptions: RequestInit = {
      method: method,
      headers: headers,
    };

    if (data) {
      headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, requestOptions);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Jira API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Handle cases where the response might be empty (e.g., 204 No Content)
      if (response.status === 204) {
        return {} as T; // Return an empty object for no content
      }

      return await response.json();
    } catch (error) {
      console.error(`Error making ${method} request to ${endpoint}:`, error);
      throw error;
    }
  }
}
