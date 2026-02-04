import { getApprovedClientsFromCookie, importKey, signData } from './workers-oauth-utils';

describe('workers-oauth-utils', () => {
  const secret = 'test-secret';

  it('getApprovedClientsFromCookie should return null for an invalid cookie', async () => {
    const invalidCookie = 'invalid-cookie-value';
    const result = await getApprovedClientsFromCookie(invalidCookie, secret);
    expect(result).toBeNull();
  });

  it('getApprovedClientsFromCookie should return the payload for a valid cookie', async () => {
    const validPayload = JSON.stringify(['client1', 'client2']);
    const key = await importKey(secret);
    const signature = await signData(key, validPayload);
    const validCookie = `${signature}.${btoa(validPayload)}`;
    const result = await getApprovedClientsFromCookie(`mcp-approved-clients=${validCookie}`, secret);
    
    expect(result).toEqual(['client1', 'client2']);
  });
});
