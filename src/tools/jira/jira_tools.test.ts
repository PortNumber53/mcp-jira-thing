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

  it('should successfully list Jira projects via manageJiraProject', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'manageJiraProject',
        args: { command: 'listProjects' },
      }),
    });
    const json = await resp.json();

    expect(resp.status).toBe(200);
    const parsed = JSON.parse(json.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.projects).toEqual([{ id: '1', key: 'TEST', name: 'Test Project', projectTypeKey: 'software' }]);
  });

  it('should successfully list Jira issue types via manageJiraProject', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'manageJiraProject',
        args: {
          command: 'getIssueTypes',
          projectIdOrKey: 'TEST',
        },
      }),
    });
    const json = await resp.json();

    expect(resp.status).toBe(200);
    const parsed = JSON.parse(json.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.projectKey).toBe('TEST');
    expect(parsed.issueTypes).toEqual([
      { id: '10001', name: 'Task', subtask: false, default: true },
      { id: '10002', name: 'Sub-task', subtask: true, default: false },
    ]);
  });
});
