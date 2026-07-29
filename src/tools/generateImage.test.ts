import { unstable_dev } from 'wrangler';

describe('MCP GenerateImage Tool', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should return 500 for /mcp when MCP_SERVER_URL is not configured', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-User-Login': 'PortNumber53',
      },
      body: JSON.stringify({
        toolName: 'generateImage',
        args: {
          prompt: 'a serene landscape',
          steps: 4,
        },
      }),
    });
    expect(resp.status).toBe(500);
    const json = await resp.json();
    expect(json.error).toContain('MCP_SERVER_URL');
  });
});
