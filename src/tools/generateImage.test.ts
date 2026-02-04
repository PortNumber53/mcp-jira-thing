import { unstable_dev } from 'wrangler';

describe('MCP GenerateImage Tool', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      vars: {
        TEST_MODE_MCP_NO_AUTH: 'true', // Use the bypass for now to test tool invocation directly
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should generate an image for an authorized user', async () => {
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'generateImage',
        args: {
          prompt: 'a serene landscape',
          steps: 4,
        },
      }),
    });
    const json = await resp.json();

    // This test is expected to fail initially because the AI binding will not be mocked,
    // and the tool might not handle user authorization properly yet.
    expect(resp.status).toBe(200);
    expect(json.content[0].type).toBe('image');
    expect(json.content[0].mimeType).toBe('image/jpeg');
    expect(json.content[0].data).toBeDefined();
  });
});
