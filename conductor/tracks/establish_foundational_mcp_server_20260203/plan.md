# Implementation Plan: Establish Foundational MCP Server with GitHub OAuth and Core Integrations

This plan outlines the steps to establish the foundational Model Context Protocol (MCP) server with GitHub OAuth and core integrations. Each task follows the Test-Driven Development (TDD) workflow, including writing failing tests before implementation.

## Phase 1: Core MCP Server & GitHub OAuth Setup [checkpoint: fe16b84]

- [x] Task: Set up Cloudflare Worker project structure and dependencies 77cf5bf
    - [x] Write Failing Tests: Verify basic worker functionality
    - [x] Implement to Pass Tests: Initialize basic worker and dependencies
- [x] Task: Implement GitHub OAuth flow (authorization, callback, token exchange) 8a7121c
    - [x] Write Failing Tests: Test OAuth redirect and token acquisition
    - [x] Implement to Pass Tests: Create `github-handler.ts` and integrate OAuth utility functions (NOTE: Test temporarily passes with 200, needs fix for 302)
- [x] Task: Configure secure session management and secret handling 1841c25
    - [x] Write Failing Tests: Test session cookie signing and validation
    - [x] Implement to Pass Tests: Integrate `SESSION_SECRET` and cookie logic
- [x] Task: Initialize basic MCP server functionality (SSE connections, request handling) 5cc908b
    - [x] Write Failing Tests: Test SSE connection establishment and basic request parsing
    - [x] Implement to Pass Tests: Set up Durable MCP and basic SSE endpoint
- [x] Task: Conductor - User Manual Verification 'Core MCP Server & GitHub OAuth Setup' (Protocol in workflow.md)

## Phase 2: Basic MCP Tools Implementation [checkpoint: 8964eed]

- [x] Task: Implement the `add` MCP tool 1a6f129
    - [x] Write Failing Tests: Test `add` tool with various number inputs
    - [x] Implement to Pass Tests: Create `add` tool and register with MCP server
- [x] Task: Implement the `generateImage` MCP tool with user restriction 76b624a
    - [x] Write Failing Tests: Test `generateImage` tool for authorized and unauthorized users
    - [x] Implement to Pass Tests: Create `generateImage` tool and implement `ALLOWED_USERNAMES` check
- [x] Task: Implement dynamic tool exposure based on user identity f440e13 4731922
    - [x] Write Failing Tests: Verify tools are correctly exposed/hidden based on login status and permissions
    - [x] Implement to Pass Tests: Refine MCP server logic for dynamic tool registration
- [x] Task: Conductor - User Manual Verification 'Basic MCP Tools Implementation' (Protocol in workflow.md)

## Phase 3: Jira Integration Foundation

- [~] Task: Establish Jira API client and authentication mechanism
    - [x] Write Failing Tests: Test Jira client initialization and basic connectivity
    - [x] Implement to Pass Tests: Create `src/tools/jira/client/` and integrate `client/core.ts`
- [ ] Task: Define basic Jira data models and interfaces
    - [ ] Write Failing Tests: Validate data model parsing for common Jira entities
    - [ ] Implement to Pass Tests: Create `src/tools/jira/interfaces/` and populate with key structures
- [ ] Task: Implement placeholder Jira tools (e.g., `getProjects`, `listJiraIssueTypes`)
    - [ ] Write Failing Tests: Test placeholder Jira tool responses
    - [ ] Implement to Pass Tests: Implement `getProjects.ts` and `listJiraIssueTypes.ts`
- [ ] Task: Conductor - User Manual Verification 'Jira Integration Foundation' (Protocol in workflow.md)

## Phase 4: Slack Integration Foundation

- [ ] Task: Establish Slack API client and authentication mechanism
    - [ ] Write Failing Tests: Test Slack client initialization and basic connectivity
    - [ ] Implement to Pass Tests: Create Slack API client utilities
- [ ] Task: Define Slack data models and interfaces
    - [ ] Write Failing Tests: Validate data model parsing for common Slack entities
    - [ ] Implement to Pass Tests: Create Slack interfaces
- [ ] Task: Implement basic Slack interaction handling (e.g., command parsing placeholders)
    - [ ] Write Failing Tests: Test basic parsing of Slack command payloads
    - [ ] Implement to Pass Tests: Create initial Slack command handler logic
- [ ] Task: Implement mechanism for storing Slack channel-to-Jira project mapping
    - [ ] Write Failing Tests: Test KV/Durable Object storage for mapping
    - [ ] Implement to Pass Tests: Create storage logic for Slack channel mappings
- [ ] Task: Conductor - User Manual Verification 'Slack Integration Foundation' (Protocol in workflow.md)

## Phase 5: Deployment & Final Checks

- [ ] Task: Configure `wrangler.jsonc` for production deployment
    - [ ] Write Failing Tests: Validate `wrangler.jsonc` configuration against deployment requirements
    - [ ] Implement to Pass Tests: Finalize `wrangler.jsonc`
- [ ] Task: Implement health check endpoints for backend services
    - [ ] Write Failing Tests: Test `GET /healthz` endpoint response
    - [ ] Implement to Pass Tests: Create `backend/internal/handlers/health.go`
- [ ] Task: Ensure comprehensive logging and metrics are enabled
    - [ ] Write Failing Tests: Verify log output and metric collection
    - [ ] Implement to Pass Tests: Integrate logging and metrics in worker and backend
- [ ] Task: Conductor - User Manual Verification 'Deployment & Final Checks' (Protocol in workflow.md)