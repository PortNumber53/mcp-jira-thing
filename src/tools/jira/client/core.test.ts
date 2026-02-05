import { JiraClientCore } from './core'; // Assuming core.ts exports JiraClient
import { vi } from 'vitest';

describe('JiraClientCore', () => {
  // Mock fetch to simulate network responses
  beforeAll(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should throw an error if environment variables are missing', () => {
    // Missing JIRA_BASE_URL
    const mockEnvMissingBaseUrl = {
      ATLASSIAN_API_KEY: 'some_key',
      JIRA_EMAIL: 'test@example.com',
    };
    expect(() => new JiraClientCore(mockEnvMissingBaseUrl as any)).toThrow("JIRA_BASE_URL environment variable is not set.");

    // Missing ATLASSIAN_API_KEY
    const mockEnvMissingApiKey = {
      JIRA_BASE_URL: 'https://jira.example.com',
      JIRA_EMAIL: 'test@example.com',
    };
    expect(() => new JiraClientCore(mockEnvMissingApiKey as any)).toThrow("ATLASSIAN_API_KEY environment variable is not set.");

    // Missing JIRA_EMAIL
    const mockEnvMissingEmail = {
      ATLASSIAN_API_KEY: 'some_key',
      JIRA_BASE_URL: 'https://jira.example.com',
    };
    expect(() => new JiraClientCore(mockEnvMissingEmail as any)).toThrow("JIRA_EMAIL environment variable is not set.");
  });

  it('should successfully make an API request with correct authentication', async () => {
    // Mock fetch to simulate a successful API response
    const mockResponse = { projects: [{ id: '1', key: 'TEST', name: 'Test Project' }] };
    (global.fetch as vi.Mock).mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
    );

    const mockEnv = {
      JIRA_BASE_URL: 'https://mock.jira.com',
      JIRA_EMAIL: 'test@example.com',
      ATLASSIAN_API_KEY: 'some_key',
    };
    const client = new JiraClientCore(mockEnv as any);

    const result = await client['makeRequest']('/rest/api/3/project', 'GET');

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://mock.jira.com/rest/api/3/project',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers), // Expect an instance of Headers
      }),
    );
    // Additionally check specific headers on the Headers object if needed
    const fetchArgs = (global.fetch as vi.Mock).mock.calls[0][1];
    expect(fetchArgs.headers.get('Authorization')).toBe('Basic dGVzdEBleGFtcGxlLmNvbTpzb21lX2tleQ==');
    expect(fetchArgs.headers.get('Accept')).toBe('application/json');
    expect(fetchArgs.headers.has('Content-Type')).toBeFalsy();
  });
});