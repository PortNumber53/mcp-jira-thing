import { unstable_dev } from 'wrangler';

describe('MCP Worker', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should return 500 for /sse when MCP_SERVER_URL is not configured', async () => {
    const resp = await worker.fetch('/sse');
    expect(resp.status).toBe(500);
    const json = await resp.json();
    expect(json.error).toContain('MCP_SERVER_URL');
  });
});
