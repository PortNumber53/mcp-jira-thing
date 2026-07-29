import { unstable_dev } from 'wrangler';

describe('MCP Jira Tools', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should return 500 for /mcp when MCP_SERVER_URL is not configured (listProjects)', async () => {
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
    expect(resp.status).toBe(500);
    const json = await resp.json();
    expect(json.error).toContain('MCP_SERVER_URL');
  });

  it('should return 500 for /mcp when MCP_SERVER_URL is not configured (projectKey)', async () => {
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
    expect(resp.status).toBe(500);
    const json = await resp.json();
    expect(json.error).toContain('MCP_SERVER_URL');
  });

  it('should return 500 for /mcp when MCP_SERVER_URL is not configured (deleteComment)', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'deleteComment',
        args: { issueKey: 'TEST-1', commentId: '10001' },
      }),
    });
    expect(resp.status).toBe(500);
    const json = await resp.json();
    expect(json.error).toContain('MCP_SERVER_URL');
  });
});
