# Changelog

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

