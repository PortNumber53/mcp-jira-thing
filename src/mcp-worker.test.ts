import { unstable_dev } from 'wrangler';

describe('MCP Worker', () => {
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

  it('should establish an SSE connection for /sse', async () => {
    const resp = await worker.fetch('/sse');
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('text/event-stream');
  });
});
