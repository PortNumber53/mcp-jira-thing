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

  it('should successfully list Jira projects via getProjectOverview', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'getProjectOverview',
        args: { listProjects: true },
      }),
    });
    const json = await resp.json();

    expect(resp.status).toBe(200);
    expect(json.data.success).toBe(true);
    expect(json.data.projects).toEqual([{ id: '1', key: 'TEST', name: 'Test Project', projectTypeKey: 'software' }]);
  });

  it('should successfully get project overview with issue types via getProjectOverview', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'getProjectOverview',
        args: {
          projectKey: 'TEST',
        },
      }),
    });
    const json = await resp.json();

    expect(resp.status).toBe(200);
    expect(json.data.success).toBe(true);
    expect(json.data.project.key).toBe('TEST');
    expect(json.data.issueTypes).toEqual([
      { id: '10001', name: 'Task', subtask: false },
      { id: '10002', name: 'Bug', subtask: false },
    ]);
  });
});
