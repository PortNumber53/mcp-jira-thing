# MCP Jira Thing: Labels & Statuses Analysis

## Date: 2026-04-23
## Analyst: Hermes Agent
## Branch: feature/FBA-62-mcp-labels-statuses-analysis
## Jira Epic: FBA-62

---

## Executive Summary

The MCP Jira Thing server **already supports** label and status management for stories and all issue types. However, there are Jira API-level constraints and workflow configuration limitations that affect usability. This document catalogs capabilities, gaps, and recommended improvements.

---

## Current Capabilities (Verified)

### Status Management

| Tool Action | Supported | Notes |
|-------------|-----------|-------|
| `getTransitions` | Yes | Returns available transitions for an issue |
| `transitionIssue` | Yes | Moves issue to a new status via transition ID |

**Verified workflow:**
```
FBA-1: To Do -> In Progress -> Done
```

The FBA project has a simple 3-status workflow:
- `11` = To Do
- `21` = In Progress
- `31` = Done

**Limitation:** There is no "Not Doing" or "Won't Fix" or "Cancelled" status in the FBA project workflow. This is a **Jira workflow configuration issue**, not an MCP server limitation.

### Label Management

| Tool Action | Supported | Notes |
|-------------|-----------|-------|
| `getLabels` | Yes | Returns all labels on an issue |
| `addLabels` | Yes | Appends labels to an issue |
| `removeLabels` | Yes | Removes specific labels |
| `setLabels` | Yes | Replaces all labels on an issue |

**Verified successful:**
```
addLabels on FBA-1 with ["not-doing"] -> Success
```

**Jira API constraint discovered:**
```
addLabels with ["not doing"] -> 400 Bad Request
Error: "The label 'not doing' can't contain spaces."
```

This is a **Jira validation rule**, not an MCP bug.

---

## Gaps & Issues Found

### 1. No "Not Doing" Status in FBA Workflow

**Problem:** When attempting to mark issues as "Not Doing", the status does not exist in the project's workflow.

**Impact:** Users must use workarounds:
- Mark as `Done` + add `not-doing` label (current workaround)
- Or configure a custom Jira workflow with a "Not Doing" status

**Recommendation:**
- Option A: Update FBA project workflow to include "Not Doing" -> "Done" transition
- Option B: Standardize on label-based approach (`not-doing`) + `Done` status
- Option C: Add MCP server helper that auto-handles "not doing" intent by applying label + transition

### 2. Label Validation Not Pre-checked

**Problem:** MCP server sends label requests directly to Jira API without pre-validation. Users get Jira API errors instead of early, friendly validation.

**Current error:**
```json
{
  "errorMessages": [],
  "errors": {
    "labels": "The label 'not doing' can't contain spaces."
  }
}
```

**Recommendation:** Add client-side validation in MCP server:
```typescript
// Pseudocode for label validation
function validateLabels(labels: string[]): ValidationResult {
  const errors = [];
  for (const label of labels) {
    if (label.includes(' ')) {
      errors.push(`Label "${label}" contains spaces. Use hyphens or underscores.`);
    }
    if (label.length > 255) {
      errors.push(`Label "${label}" exceeds 255 characters.`);
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
```

### 3. No Bulk Status/Label Operations

**Problem:** Cannot transition or label multiple issues in one call. The Flutter Base App update required 4 separate `transitionIssue` calls and 4 separate `addLabels` calls.

**Recommendation:** Add bulk operation actions:
```typescript
// Proposed new actions
{
  "action": "transitionIssues",
  "issueIdsOrKeys": ["FBA-1", "FBA-37", "FBA-39", "FBA-32"],
  "transitionId": "31"
}

{
  "action": "addLabelsBulk",
  "issueIdsOrKeys": ["FBA-1", "FBA-37", "FBA-39", "FBA-32"],
  "labels": ["not-doing"]
}
```

### 4. Status Name vs ID Mapping Not Exposed

**Problem:** `getTransitions` returns IDs (`11`, `21`, `31`) but not human-readable status names. Users must guess or map manually.

**Current output:**
```
11: To Do -> To Do
21: In Progress -> In Progress
31: Done -> Done
```

**Recommendation:** Enhance `getTransitions` response:
```json
{
  "transitions": [
    {
      "id": "11",
      "name": "To Do",
      "from": ["In Progress"],
      "to": "To Do"
    }
  ]
}
```

### 5. No Workflow Configuration Access

**Problem:** Cannot view or modify project workflows via MCP. To add "Not Doing" status, user must go to Jira UI.

**Recommendation:** (Low priority) Add read-only workflow inspection:
```typescript
{
  "action": "getWorkflow",
  "projectKey": "FBA"
}
```

---

## Positive Findings

1. **Rich issue CRUD**: createIssue, getIssue, updateIssue, deleteIssue all work well
2. **Comment management**: Full lifecycle supported
3. **Attachment support**: addAttachment, listAttachments, deleteAttachment
4. **Priority management**: listPriorities, setPriority
5. **Assignment**: assignIssue, unassignIssue
6. **Sprint integration**: manageJiraSprint tool works
7. **Search**: JQL searchIssues with full field expansion

---

## Recommendations Summary

| Priority | Improvement | Effort |
|----------|-------------|--------|
| High | Add label pre-validation | Small |
| High | Add bulk transition/label operations | Medium |
| Medium | Enhance getTransitions with metadata | Small |
| Medium | Add "not-doing" helper (label + transition) | Small |
| Low | Add workflow inspection (read-only) | Medium |
| Low | Document Jira label constraints | Tiny |

---

## Testing Notes

Tested against:
- Project: FBA (Flutter Base App)
- Issues: FBA-1, FBA-37, FBA-39, FBA-32 (legacy, now Done + not-doing label)
- Issues: FBA-46 through FBA-61 (new epics/stories/tasks, active)

All label and status operations succeeded except for the space-in-label constraint which is a Jira API rule.
