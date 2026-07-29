import { unstable_dev } from 'wrangler';

describe('GitHub OAuth Flow', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      // Mock environment variables required by github-handler.ts
      vars: {
        GITHUB_CLIENT_ID: 'test_client_id',
        GITHUB_CLIENT_SECRET: 'test_client_secret',
        SESSION_SECRET: 'super_secret_session_key_123456789012345678901234567890',
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should not return 200 for /authorize (OAuth provider removed)', async () => {
    const resp = await worker.fetch('/authorize?client_id=test_client', {
      method: 'GET',
    });
    expect(resp.status).not.toBe(200);
  });
});