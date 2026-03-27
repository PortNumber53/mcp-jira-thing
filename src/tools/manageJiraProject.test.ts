import { unstable_dev } from 'wrangler';

describe('MCP manageJiraProject Tool', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      vars: {
        TEST_MODE_TOOL_INVOCATION: 'true',
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should list projects via manageJiraProject', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'manageJiraProject',
        args: {
          command: 'listProjects',
        },
      }),
    });
    const json = await resp.json();

    expect(resp.status).toBe(200);
    expect(json.content).toBeDefined();
    expect(json.content[0].type).toBe('text');
    const parsed = JSON.parse(json.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0].key).toBe('TEST');
  });
});
