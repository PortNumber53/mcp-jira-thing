import { unstable_dev } from 'wrangler';

describe('MCP Add Tool', () => {
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

  it('should return the sum of two numbers', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'add',
        args: {
          a: 5,
          b: 3,
        },
      }),
    });
    const json = await resp.json();

    expect(resp.status).toBe(200);
    expect(json.result).toBe(8);
  });
});
