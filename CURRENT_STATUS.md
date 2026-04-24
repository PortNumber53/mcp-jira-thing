# Current Status: mcp-jira-thing

## Project Overview
- **Location**: `/Users/grimlock/projects/mcp-jira-thing`
- **Git Repository**: git@github.com:PortNumber53/mcp-jira-thing.git
- **Current Branch**: feature/FBA-62-mcp-labels-statuses-analysis
- **Last Commit**: c669338 MJT-50: Add workflow management system design

## Description
MCP (Model Context Protocol) server for Jira integration, consumed by Hermes AI Agent.

## Technical Stack
- **Server Type**: Remote MCP (via mcp-remote proxy)
- **Endpoint**: https://jira-thing.truvis.co/mcp
- **Protocol**: MCP over HTTP/SSE
- **Documentation**: Markdown-based design docs

## Project Structure
- **Total Files**: 4
- **Has Tests**: No
- **Has Docker**: No
- **Has CI/CD**: Yes (GitLab SAST)
- **Has README**: Yes

### Top-level Structure
```
mcp-jira-thing/
  docs/
    WORKFLOW_MANAGEMENT_DESIGN.md      # MJT-50 workflow system design
    MCP_LABELS_STATUSES_ANALYSIS.md    # FBA-62 labels/statuses gap analysis
    MCP_SERVER_IMPROVEMENTS_SPEC.md    # FBA-62 implementation spec
  README.md
  CURRENT_STATUS.md
  .gitlab-ci.yml
```

## MCP Server Capabilities Analysis (FBA-62)

### Labels: Supported
| Action | Status | Notes |
|--------|--------|-------|
| getLabels | Working | Returns issue labels |
| addLabels | Working | Jira rejects spaces in labels |
| removeLabels | Working | Removes specified labels |
| setLabels | Working | Replaces all labels |

**Known Issue:** Jira API rejects labels with spaces (e.g., `not doing`).
**Workaround:** Use hyphens: `not-doing`.
**Recommendation:** Add pre-validation middleware (see Improvements Spec).

### Statuses/Transitions: Supported
| Action | Status | Notes |
|--------|--------|-------|
| getTransitions | Working | Returns transition IDs |
| transitionIssue | Working | Changes issue status |

**Known Issue:** FBA project has only 3 statuses (To Do, In Progress, Done).
There is no "Not Doing" status.
**Workaround:** Mark as `Done` + add `not-doing` label.
**Recommendation:** Add `markNotDoing` helper action.

### Other Verified Capabilities
- Issue CRUD (create, get, update, delete)
- Comment lifecycle (add, update, delete, list)
- Attachments (add, list, delete)
- Priority management
- Assignment (assign/unassign)
- Sprint management
- JQL search with field expansion
- Project management (list, get, create)
- User management (search, get)

## Development Status
- Design docs complete for workflow management (MJT-50)
- Gap analysis complete for labels/statuses (FBA-62)
- Implementation spec drafted (FBA-62)
- Source code lives in remote server, not this repo
- This repo serves as design documentation and feature tracking

## Quick Start
```bash
# View analysis
cat docs/MCP_LABELS_STATUSES_ANALYSIS.md

# View implementation spec
cat docs/MCP_SERVER_IMPROVEMENTS_SPEC.md
```

## Notes
- The actual MCP server binary/source is deployed remotely at jira-thing.truvis.co
- This repository tracks design docs, specs, and analysis
- Generated on: 2026-04-23
- Analysis based on real-world usage with FBA (Flutter Base App) project

---
*This status was updated during FBA-62 analysis.*
