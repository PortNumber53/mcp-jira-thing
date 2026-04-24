# MCP Jira Thing Server: Improvements Specification

## Scope: Labels & Statuses Management Enhancement

---

## 1. Label Pre-Validation Middleware

### Current Behavior
Labels are sent directly to Jira API. Invalid labels result in 400 Bad Request from Jira.

### Desired Behavior
Validate labels before sending to Jira API. Return friendly error messages.

### Implementation
```typescript
// src/middleware/labelValidation.ts
interface LabelValidationResult {
  valid: boolean;
  errors: string[];
  normalizedLabels?: string[];
}

const JIRA_LABEL_RULES = {
  maxLength: 255,
  noSpaces: true,
  allowedChars: /^[a-zA-Z0-9_\-\.]+$/,
};

export function validateLabels(labels: string[]): LabelValidationResult {
  const errors: string[] = [];
  const normalizedLabels: string[] = [];

  for (const label of labels) {
    // Check for spaces
    if (label.includes(' ')) {
      const suggestion = label.replace(/\s+/g, '-').toLowerCase();
      errors.push(
        `Label "${label}" contains spaces. ` +
        `Jira labels cannot contain spaces. ` +
        `Suggestion: "${suggestion}"`
      );
      normalizedLabels.push(suggestion);
      continue;
    }

    // Check length
    if (label.length > JIRA_LABEL_RULES.maxLength) {
      errors.push(
        `Label "${label}" is ${label.length} characters. ` +
        `Max allowed: ${JIRA_LABEL_RULES.maxLength}`
      );
      continue;
    }

    // Check allowed characters
    if (!JIRA_LABEL_RULES.allowedChars.test(label)) {
      errors.push(
        `Label "${label}" contains invalid characters. ` +
        `Only alphanumeric, hyphens, underscores, and dots are allowed.`
      );
      continue;
    }

    normalizedLabels.push(label);
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedLabels: errors.length === 0 ? normalizedLabels : undefined,
  };
}
```

### Integration Points
- `addLabels` action
- `setLabels` action
- `removeLabels` action (for consistency)

---

## 2. Bulk Operations

### 2.1 Bulk Transition

#### New Action: `transitionIssues`
```typescript
interface TransitionIssuesInput {
  action: 'transitionIssues';
  issueIdsOrKeys: string[];  // e.g., ["FBA-1", "FBA-37"]
  transitionId: string;      // e.g., "31"
}

interface TransitionIssuesResult {
  succeeded: { issueKey: string; newStatus: string }[];
  failed: { issueKey: string; error: string }[];
}
```

#### Implementation Strategy
```typescript
async function transitionIssues(
  issueIdsOrKeys: string[],
  transitionId: string
): Promise<TransitionIssuesResult> {
  const results: TransitionIssuesResult = {
    succeeded: [],
    failed: [],
  };

  // Execute in parallel with concurrency limit
  const concurrencyLimit = 5;
  const chunks = chunkArray(issueIdsOrKeys, concurrencyLimit);

  for (const chunk of chunks) {
    const promises = chunk.map(async (issueKey) => {
      try {
        await jiraClient.transitionIssue(issueKey, transitionId);
        const updated = await jiraClient.getIssue(issueKey, { fields: ['status'] });
        results.succeeded.push({
          issueKey,
          newStatus: updated.fields.status.name,
        });
      } catch (error) {
        results.failed.push({
          issueKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.all(promises);
  }

  return results;
}
```

### 2.2 Bulk Labels

#### New Action: `addLabelsBulk`
```typescript
interface AddLabelsBulkInput {
  action: 'addLabelsBulk';
  issueIdsOrKeys: string[];
  labels: string[];
}

interface AddLabelsBulkResult {
  succeeded: string[];
  failed: { issueKey: string; error: string }[];
}
```

---

## 3. Enhanced getTransitions

### Current Output
```
11: To Do -> To Do
21: In Progress -> In Progress
31: Done -> Done
```

### Desired Output
```json
{
  "transitions": [
    {
      "id": "11",
      "name": "To Do",
      "toStatus": {
        "id": "10000",
        "name": "To Do",
        "category": "todo"
      },
      "available": true
    },
    {
      "id": "21",
      "name": "In Progress",
      "toStatus": {
        "id": "10001",
        "name": "In Progress",
        "category": "indeterminate"
      },
      "available": true
    },
    {
      "id": "31",
      "name": "Done",
      "toStatus": {
        "id": "10002",
        "name": "Done",
        "category": "done"
      },
      "available": true
    }
  ]
}
```

---

## 4. "Not Doing" Helper Action

### New Action: `markNotDoing`

Since "Not Doing" is not a standard Jira status, provide a convenience action:

```typescript
interface MarkNotDoingInput {
  action: 'markNotDoing';
  issueIdOrKey: string;
  reason?: string;  // Optional comment explaining why
}

async function markNotDoing(
  issueIdOrKey: string,
  reason?: string
): Promise<void> {
  // 1. Get available transitions
  const transitions = await jiraClient.getTransitions(issueIdOrKey);

  // 2. Find transition to "Done" or equivalent terminal status
  const doneTransition = transitions.find(
    (t) => t.toStatus?.category === 'done' || t.name === 'Done'
  );

  if (!doneTransition) {
    throw new Error(
      `No "Done" transition available for ${issueIdOrKey}. ` +
      `Available: ${transitions.map((t) => t.name).join(', ')}`
    );
  }

  // 3. Transition to Done
  await jiraClient.transitionIssue(issueIdOrKey, doneTransition.id);

  // 4. Add not-doing label
  await jiraClient.addLabels(issueIdOrKey, ['not-doing']);

  // 5. Optionally add comment
  if (reason) {
    await jiraClient.addComment(
      issueIdOrKey,
      `Marked as "Not Doing". Reason: ${reason}`
    );
  }
}
```

---

## 5. Testing Plan

### Unit Tests
```typescript
describe('Label Validation', () => {
  it('rejects labels with spaces', () => {
    const result = validateLabels(['not doing']);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('spaces');
    expect(result.normalizedLabels?.[0]).toBe('not-doing');
  });

  it('accepts valid labels', () => {
    const result = validateLabels(['not-doing', 'bug', 'feature.v2']);
    expect(result.valid).toBe(true);
  });

  it('rejects labels over 255 chars', () => {
    const longLabel = 'a'.repeat(256);
    const result = validateLabels([longLabel]);
    expect(result.valid).toBe(false);
  });
});

describe('Bulk Operations', () => {
  it('transitions multiple issues', async () => {
    const result = await transitionIssues(
      ['FBA-1', 'FBA-2'],
      '31'
    );
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });
});
```

### Integration Tests
1. Test against real Jira project (FBA)
2. Verify label validation catches spaces
3. Verify bulk operations handle partial failures
4. Verify markNotDoing transitions + labels correctly

---

## 6. API Compatibility

All new actions must maintain backward compatibility:
- Existing `addLabels`, `removeLabels`, `setLabels`, `transitionIssue` remain unchanged
- New actions are additive only
- No breaking changes to existing tool signatures

---

## 7. Documentation Updates

Update `README.md` or create `API.md` with:
- All available actions (existing + new)
- Jira constraints (label rules, workflow limitations)
- Examples for common operations
- Error handling guide
