import { unstable_dev } from 'wrangler';

describe('MCP Dynamic Tool Exposure', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      vars: {
        TEST_MODE_MCP_NO_AUTH: 'true', // Temporarily bypass OAuth for direct tool invocation
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should not allow unauthorized users to access generateImage tool', async () => {
    // Simulate an unauthorized user (no 'login' in props) trying to access generateImage
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'generateImage',
        args: {
          prompt: 'a forbidden image',
          steps: 4,
        },
      }),
    });
    const json = await resp.json();

    // This test is expected to fail initially because the tool might still execute
    // or return a generic error instead of an explicit authorization failure.
    expect(resp.status).toBe(403); // Expect Forbidden
    expect(json.error).toMatch(/unauthorized/i); // Expect an unauthorized error message
  });

  it('should allow authorized users to access generateImage tool', async () => {
    // This test will need a way to simulate an authorized user (e.g., via mocked props)
    // For now, it will likely fail or require further mocking/implementation.
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-User-Login': 'PortNumber53', // Simulate authorized user
      },
      body: JSON.stringify({
        toolName: 'generateImage',
        args: {
          prompt: 'an authorized image',
          steps: 4,
        },
      }),
    });
    const json = await resp.json();

    // This test is expected to fail initially or return incorrect data
    expect(resp.status).toBe(200);
    expect(json.content[0].type).toBe('image');
  });
});
