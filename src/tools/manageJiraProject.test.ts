import { unstable_dev } from 'wrangler';

describe('MCP getProjectOverview Tool', () => {
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

  it('should list projects via getProjectOverview', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'getProjectOverview',
        args: {
          listProjects: true,
        },
      }),
    });
    const json = await resp.json();

    expect(resp.status).toBe(200);
    expect(json.content).toBeDefined();
    expect(json.content[0].type).toBe('text');
    expect(json.data.success).toBe(true);
    expect(json.data.projects).toHaveLength(1);
    expect(json.data.projects[0].key).toBe('TEST');
  });
});
