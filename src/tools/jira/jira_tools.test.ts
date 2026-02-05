import { unstable_dev } from 'wrangler';
import { vi } from 'vitest'; // Keep vi import for global.fetch mock

describe('MCP Jira Tools', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      vars: {
        TEST_MODE_TOOL_INVOCATION: 'true', // Temporarily bypass OAuth for direct tool invocation
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should successfully get Jira projects', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'getProjects',
        args: {},
      }),
    });
    const json = await resp.json();

    expect(resp.status).toBe(200);
    expect(json.data.success).toBe(true);
    expect(json.data.projects).toEqual([{ id: '1', key: 'TEST', name: 'Test Project' }]);
  });

  it('should successfully list Jira issue types', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'listJiraIssueTypes',
        args: {
          projectIdOrKey: 'TEST',
        },
      }),
    });
    const json = await resp.json();

    expect(resp.status).toBe(200);
    expect(json.data.success).toBe(true);
    expect(json.data.projectKey).toBe('TEST');
    expect(json.data.issueTypes).toEqual([{ id: '10001', name: 'Task', subtask: false }, { id: '10002', name: 'Sub-task', subtask: true }]);
  });
});
