import { z } from 'zod';
// Assuming JiraProjectSchema will be exported from index.ts
import { JiraProjectSchema } from './index';

describe('Jira Interfaces', () => {
  it('JiraProjectSchema should fail to parse invalid data', () => {
    // This test is designed to fail initially because JiraProjectSchema is not yet defined
    // or the parsing logic will reject malformed data.
    const invalidProjectData = {
      id: 123, // Should be string
      key: 'INV',
      name: 'Invalid Project',
      projectTypeKey: 'software',
      simplified: true,
    };

    // Expecting the parsing to fail, as 'id' is a number instead of a string
    expect(() => JiraProjectSchema.parse(invalidProjectData)).toThrow(z.ZodError);
  });
});
