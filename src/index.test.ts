import { unstable_dev } from 'wrangler';
import { assert } from 'console';

describe('Worker', () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should return 200 for /', async () => {
    const resp = await worker.fetch('/');
    expect(resp.status).toBe(200);
  });
});
