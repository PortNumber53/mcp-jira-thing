# Changelog

## 2025-11-11

- doc: Updated .windsurf_plan.md and CHANGELOG.md to log analysis and commit process

## 2025-11-10

- refactor(mcp-tools): Centralize MCP tool registration logic
  - Moved all `this.server.tool(...)` registrations out of `src/index.ts`
  - Updated `registerTools` in `src/include/tools.js` to host every tool, including the basic `add` helper
  - Simplified `MyMCP.init` to call `registerTools` with the proper `this` binding, removing duplicate inline definitions

## 2025-11-09

- chore: Sync repository with remote origin
  - Reset local branch to match `origin/master` at commit `055d32f`
  - Discarded 4 local commits that had diverged from remote
  - Updated frontend dependencies - added peer dependencies to package-lock.json
  - Repository is now up-to-date with latest remote changes

- feat(metrics): Add request tracking and usage metrics
  - Database:
    - Add `requests` table with migration 0005_add_requests_table.up.sql
    - Tracks user_id, method, endpoint, status_code, response_time_ms, request/response sizes
    - Includes performance indexes for analytics queries
  - Models:
    - Add `Request` struct for individual request records
    - Add `RequestMetrics` struct for aggregated usage statistics
  - Backend:
    - Add request tracking middleware in `backend/internal/middleware/`
    - Add store methods: CreateRequest, GetUserRequests, GetUserMetrics, GetAllMetrics
    - Add API endpoints: /api/metrics/user, /api/metrics/user/requests, /api/metrics/all
  - Integration:
    - Updated HTTP server to include request tracking middleware
    - Configured to track all API calls with response times and sizes

## 2025-10-14

- feat(jira-comments): Implement full comment management support
  - Interfaces (`src/tools/jira/interfaces/index.ts`):
    - Add `updateAuthor`, `visibility` to `JiraComment`
    - Add `startAt` to `JiraCommentPage`
    - Introduce `JiraCommentPageBean`, `JiraCommentListOptions`, `JiraCommentWriteOptions`
  - Client (`src/tools/jira/client/issues.ts`):
    - `listComments(issueIdOrKey, options)` now supports `startAt`, `maxResults`, `orderBy`, `expand`
    - `addComment(issueIdOrKey, body, options)` supports `visibility`, `properties`, `expand`
    - `updateComment(issueIdOrKey, commentId, body, options)` supports `visibility`, `properties`, `notifyUsers`, `overrideEditableFlag`, `expand`
    - Add `getComment(issueIdOrKey, commentId)`
    - Add `getCommentsByIds(ids, expand)` (POST `/rest/api/3/comment/list`)
  - Facade (`src/tools/jira/index.ts`):
    - Expose `listIssueComments(options)`, `addIssueComment(options)`, `updateIssueComment(options)`
    - Add `getIssueComment()`, `getIssueCommentsByIds()`
  - MCP Tool (`src/index.ts`):
    - Add actions `getComment`, `getCommentsByIds`
    - Enhance `listComments`, `addComment`, `updateComment` with list/write options
    - Introduce `listCommentsFull` to return ids, raw comments, and extracted plain text in one tool call
    - Avoid schema key collision by using `commentProperties` (left `properties` for issue fetch filtering)

- chore: Minor help text and schema updates for the new actions

### Notes
- A pre-existing lint warning remains regarding `Env` in `src/index.ts` (missing `COOKIE_ENCRYPTION_KEY`). This was not introduced by this change. Consider updating the `Env` type or configuration accordingly.

- fix(jira): Correct search endpoint in `JiraIssues.searchIssues` (`src/tools/jira/client/issues.ts`).
  - Changed from `/rest/api/3/search/jql` to `/rest/api/3/search`.
  - Rationale: Jira REST API expects `jql` as a query parameter, not a path segment. This resolves MCP search errors.
