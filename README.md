# Model Context Protocol (MCP) Server with GitHub OAuth

This project provides a template for a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) server that uses GitHub for OAuth 2.0 authentication. It is built to run on [Cloudflare Workers](https://developers.cloudflare.com/workers/), providing a robust and scalable foundation for your own remote MCP services.

Users can connect to your deployed MCP server, and they will be prompted to sign in with their GitHub account to authorize access.

## Features

- **GitHub OAuth Integration**: Securely authenticates users via GitHub, acting as an OAuth client to GitHub and an OAuth server to the MCP client.
- **Dynamic Tool Loading**: Demonstrates how to conditionally expose tools based on the authenticated user's identity.
- **Example Tools**: Includes two sample tools:
  - A public `add` tool available to all authenticated users.
  - A restricted `generateImage` tool that is only available to a predefined list of authorized users.
- **Serverless Deployment**: Built on Cloudflare Workers for a scalable, low-maintenance, serverless architecture.
- **Secure Secret Management**: Uses Wrangler secrets to manage sensitive credentials, avoiding hard-coded values in the source code.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- `npm` or a compatible package manager

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/PortNumber53/mcp-jira-thing.git
    cd mcp-jira-thing
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

## React Frontend (`frontend/`)

A React + Vite single-page application lives under `frontend/`. It provides the GitHub sign-in flow for users and can be developed with the standard Vite server.

```bash
cd mcp-jira-thing
npm install    # install Worker + shared dependencies (repo root)

cd frontend
npm install    # install local dependencies before development
npm run dev          # starts the Vite development server with HMR
npm run dev:worker   # runs the merged Worker locally on :18112
```

For reproducible builds and deployment:

```bash
npm run build   # runs tsc + vite build (Worker deploy is from repo root)
npm run deploy  # uploads the merged Worker and SPA assets via wrangler deploy
```

The Cloudflare Worker is defined at the repository root (`src/index.ts`). It serves the SPA from `frontend/dist/client` at `/` and exposes the MCP server under `/sse` (and `/mcp`). Deployment is performed from the repo root with `npm run deploy`, which builds the SPA first. Running `npm run dev:worker` in `frontend/` starts the same merged Worker locally using `../wrangler.jsonc`.

## Slack App (per-channel Jira project integration)

If you want Slack users to interact with Jira *in the context of a Slack channel* (e.g. create/search issues against a default Jira project per channel), connect a Slack app to this Worker and store a mapping:

- **Slack channel ID** → **Jira project key** (e.g. `C01234567` → `ENG`)

This repository does **not** ship Slack endpoints yet, but the steps below describe the configuration you’ll need once you add them.

### 1) Create a Slack app

In Slack, create an app from scratch and enable:

- **Interactivity & Shortcuts** (optional but recommended)
- **Slash Commands** (recommended)
- **Event Subscriptions** (optional; useful for `@yourapp` mentions)
- **OAuth & Permissions**

### 2) OAuth settings + required scopes

Add a redirect URL for the Worker, for example:

- `http://localhost:18112/slack/oauth/callback` (local)
- `https://<your-worker>.<your-subdomain>.workers.dev/slack/oauth/callback` (prod)

Suggested bot token scopes (adjust to your needs):

- **`commands`**: enable slash commands like `/jira`
- **`chat:write`**: post responses/messages
- **`channels:read`** and/or **`groups:read`**: read channel metadata (public vs private)
- **`app_mentions:read`** (if using events for mentions)
- **`users:read`** (if you want to display usernames / enrich messages)

### 3) Configure Slack request URLs (Worker endpoints you’ll add)

Once implemented, Slack should point to Worker endpoints like:

- **Slash command request URL**: `.../slack/commands`
- **Interactivity request URL**: `.../slack/interactions`
- **Events request URL** (if enabled): `.../slack/events`

All of these endpoints should:

- **Verify Slack signatures** using `SLACK_SIGNING_SECRET`
- **Ack within 3 seconds** (use `response_url` or async follow-ups for slow Jira calls)

### 4) Store “channel → Jira project” mapping

Recommended approach in this repo:

- **Store mapping in Cloudflare KV** (simple) or a **Durable Object** (strong consistency)
- Key by channel ID, value includes at least `{ projectKey, updatedAt, updatedBy }`

Example mapping key:

- `slack:channel-project:C01234567` → `{"projectKey":"ENG","updatedAt":...}`

### 5) Suggested Slack UX (commands)

One practical pattern is a `/jira` command that sets or uses the channel’s default project:

- **Set default**: `/jira project set ENG`
- **Show default**: `/jira project get`
- **Create issue**: `/jira create "Bug title" --type Task`
- **Search**: `/jira search status=Open assignee=me`

Implementation detail: the handler reads the channel ID from Slack payload, looks up the project key for that channel, then calls the existing Jira client/tooling in `src/tools/jira/` to perform the requested action.

### 6) Environment variables you’ll need

Add these as Wrangler secrets/vars (names are suggestions; pick a convention and stick to it):

- **`SLACK_SIGNING_SECRET`**: required to verify Slack requests
- **`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`**: required for Slack OAuth install flow
- **`SLACK_BOT_TOKEN`**: required to call Slack APIs (or store per-workspace tokens after OAuth)

If you support multiple Slack workspaces, store the workspace/team install info keyed by `team_id`, not globally.

## Go Backend (`backend/`)

The Go backend exposes REST endpoints that serve data to the frontend (or other consumers). The initial implementation ships with:

- `GET /healthz` — simple health probe for load balancers and Jenkins smoke checks.
- `GET /api/users?limit=50` — returns a paginated list of NextAuth users from the database.

### Environment variables

Create a copy of `backend/env.example` and provide the required values:

| Variable                       | Required | Description                                                   |
| ------------------------------ | -------- | ------------------------------------------------------------- |
| `BACKEND_ADDR`                 | optional | Address the HTTP server listens on. Defaults to `:18111`.      |
| `DATABASE_URL`                 | ✅       | Postgres DSN used by the backend at runtime. |
| `BACKEND_HTTP_TIMEOUT_SECONDS` | optional | Outbound request timeout, defaults to 15 seconds.             |



`go test` and the runtime code expect the environment variables to be present. When running locally you can export them or use a dotenv loader (`direnv`, `dotenvx`, etc.).

### Local development

```bash
cd backend
cp env.example .env   # edit with your credentials (or export env vars)
go test ./...
go run ./cmd/server

# or via make
make test
make run
```

#### Hot reload with Air

[Air](https://github.com/air-verse/air) offers live-reload for Go applications so changes rebuild and restart automatically during development, shrinking feedback loops [^air].

```bash
# install once (requires Go 1.25+)
go install github.com/air-verse/air@latest

# start the watcher from the backend directory
cd backend
make dev  # runs `air -c .air.toml`
```

Air uses the configuration at `backend/.air.toml` to rebuild `./tmp/main` whenever Go or environment files change, then restarts the server transparently. Ensure your `.env` values are present before launching the watcher.

### Deployment workflow

- **Build/Test:** `make build` compiles a Linux static binary at `backend/bin/mcp-backend`. `make test` runs the unit tests. Both commands are orchestrated by the Jenkins pipeline (see below).
- **Artifact:** Jenkins compresses the binary to `backend/bin/mcp-backend.tar.gz` and publishes it as a build artifact.
- **Deploy script:** `scripts/deploy-backend.sh` cross-compiles the Linux binary, uploads it via `scp`, unpacks it under `$DEPLOY_PATH`, and optionally restarts a systemd service when `SERVICE_NAME` is provided.

### Jenkins pipeline

This repository now contains a top-level `Jenkinsfile` that performs the following stages:

1. **Checkout** — pulls the repository for the current build.
2. **Go Test** — runs `go test ./...` inside `backend/`.
3. **Build Backend** — executes `make build` to generate the `mcp-backend` binary.
4. **Archive Artifact** — tars the binary and archives it for later retrieval.
5. **Deploy (master only)** — executes `scripts/deploy-backend.sh`, which expects the following environment variables to be supplied by Jenkins credentials or job configuration:
   - `DEPLOY_HOST`: Production server host/IP (Arch Linux).
   - `DEPLOY_USER`: SSH user with permission to write into `DEPLOY_PATH` **and** run `sudo systemctl restart` on the target service.
   - `DEPLOY_PATH`: Target directory on the server (e.g. `/opt/mcp-backend`).
   - `SERVICE_NAME` (optional): systemd unit name to restart after deployment.

The deploy stage only runs for builds on the `master` branch, so feature branches remain test-only. Jenkins must provide SSH access, typically via an SSH key credential associated with the `DEPLOY_USER` account. Review `scripts/deploy-backend.sh` for additional details or customization points.

[^air]: Air is an open-source live reload utility for Go apps that watches source code, rebuilds, and reruns the compiled binary automatically to streamline development [air-verse/air](https://github.com/air-verse/air).

## Configuration and Deployment

Follow these steps to configure and deploy your MCP server.

### 1. Create a GitHub OAuth App

First, you need to create a [GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) to get your client credentials.

- **Homepage URL**: `https://<your-worker-name>.<your-subdomain>.workers.dev`
- **Authorization callback URL**: `https://<your-worker-name>.<your-subdomain>.workers.dev/callback/github`

Once the app is created, note the **Client ID** and generate a new **Client secret**.

### 2. Configure Secrets

Next, use Wrangler to securely store your GitHub credentials and a session encryption key as secrets.

```bash
# Will prompt for your GitHub Client ID
npx wrangler secret put GITHUB_CLIENT_ID

# Will prompt for your GitHub Client Secret
npx wrangler secret put GITHUB_CLIENT_SECRET

# Will prompt for a random string used to sign session cookies
npx wrangler secret put SESSION_SECRET

# Optionally, provide COOKIE_SECRET if you need an override for local testing
npx wrangler secret put COOKIE_SECRET
```

For the `SESSION_SECRET`, you can generate a secure random string with `openssl rand -hex 32`.

### 3. Session Storage

OAuth state and user session data are stored in signed, HTTP-only cookies; no Cloudflare KV namespace is required. Ensure `SESSION_SECRET` (or `COOKIE_SECRET`) is configured so the Worker can sign and validate those cookies securely. If you previously used `COOKIE_ENCRYPTION_KEY`, rename that secret to `SESSION_SECRET`.

### 4. Authorize Users

To grant access to restricted tools like `generateImage`, you must add the GitHub usernames of authorized users to the `ALLOWED_USERNAMES` set in `src/index.ts`.

```typescript
// src/index.ts
const ALLOWED_USERNAMES = new Set<string>([
  "PortNumber53",
  // Add other authorized GitHub usernames here
]);
```

### 5. Deploy the Worker

Finally, deploy your configured worker to Cloudflare.

```bash
npx wrangler deploy
```

## Available Tools

This MCP server exposes the following tools:

- **`add`**

  - **Description**: Adds two numbers.
  - **Access**: Public (available to all authenticated users).
  - **Parameters**: `a` (number), `b` (number).

- **`generateImage`**
  - **Description**: Generates an image using the `@cf/black-forest-labs/flux-1-schnell` model.
  - **Access**: Restricted (only available to users in `ALLOWED_USERNAMES`).
  - **Parameters**: `prompt` (string), `steps` (number, 4-8).

## Usage

You can test your remote server using the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector@latest
```

Enter your worker's SSE URL (`https://<your-worker-name>.<your-subdomain>.workers.dev/sse`) and click **Connect**. You will be redirected to GitHub to authenticate. Once authenticated, you will see the available tools in the Inspector.

<img width="640" alt="MCP Inspector showing available tools" src="https://github.com/user-attachments/assets/7973f392-0a9d-4712-b679-6dd23f824287" />

## Project Structure

- `src/index.ts`: The main entry point for the Cloudflare Worker. Defines the MCP server, its tools, and the logic for conditional tool access.
- `src/github-handler.ts`: Contains the logic for handling the GitHub OAuth flow.
- `src/workers-oauth-utils.ts`: Provides utility functions for the OAuth process, adapted from the `workers-oauth-provider` library.
- `wrangler.jsonc`: The configuration file for the Cloudflare Worker.
- `package.json`: Defines project scripts and dependencies.

You now have a remote MCP server deployed!

### Access Control

This MCP server uses GitHub OAuth for authentication. All authenticated GitHub users can access basic tools like "add" and "userInfoOctokit".

The "generateImage" tool is restricted to specific GitHub users listed in the `ALLOWED_USERNAMES` configuration:

```typescript
// Add GitHub usernames for image generation access
const ALLOWED_USERNAMES = new Set(["yourusername", "teammate1"]);
```

### Access the remote MCP server from Claude Desktop

Open Claude Desktop and navigate to Settings -> Developer -> Edit Config. This opens the configuration file that controls which MCP servers Claude can access.

Replace the content with the following configuration. Once you restart Claude Desktop, a browser window will open showing your OAuth login page. Complete the authentication flow to grant Claude access to your MCP server. After you grant access, the tools will become available for you to use.

```
{
  "mcpServers": {
    "math": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp-github-oauth.<your-subdomain>.workers.dev/sse"
      ]
    }
  }
}
```

Once the Tools (under 🔨) show up in the interface, you can ask Claude to use them. For example: "Could you use the math tool to add 23 and 19?". Claude should invoke the tool and show the result generated by the MCP server.

### For Local Development

If you'd like to iterate and test your MCP server, you can do so in local development. This will require you to create another OAuth App on GitHub:

- For the Homepage URL, specify `http://localhost:18112`
- For the Authorization callback URL, specify `http://localhost:18112/callback/github`
- Note your Client ID and generate a Client secret.
- Create a `.dev.vars` file in your project root with:

```
GITHUB_CLIENT_ID=your_development_github_client_id
GITHUB_CLIENT_SECRET=your_development_github_client_secret
```

#### Develop & Test

Run the server locally to make it available at `http://localhost:18112`
`wrangler dev`

To test the local server, enter `http://localhost:18112/sse` into Inspector and hit connect. Once you follow the prompts, you'll be able to "List Tools".

#### Using Claude and other MCP Clients

When using Claude to connect to your remote MCP server, you may see some error messages. This is because Claude Desktop doesn't yet support remote MCP servers, so it sometimes gets confused. To verify whether the MCP server is connected, hover over the 🔨 icon in the bottom right corner of Claude's interface. You should see your tools available there.

#### Using Cursor and other MCP Clients

To connect Cursor with your MCP server, choose `Type`: "Command" and in the `Command` field, combine the command and args fields into one (e.g. `npx mcp-remote https://<your-worker-name>.<your-subdomain>.workers.dev/sse`).

Note that while Cursor supports HTTP+SSE servers, it doesn't support authentication, so you still need to use `mcp-remote` (and to use a STDIO server, not an HTTP one).

You can connect your MCP server to other MCP clients like Windsurf by opening the client's configuration file, adding the same JSON that was used for the Claude setup, and restarting the MCP client.

## How does it work?

#### OAuth Provider

The OAuth Provider library serves as a complete OAuth 2.1 server implementation for Cloudflare Workers. It handles the complexities of the OAuth flow, including token issuance, validation, and management. In this project, it plays the dual role of:

- Authenticating MCP clients that connect to your server
- Managing the connection to GitHub's OAuth services
- Securely storing tokens and authentication state in KV storage

#### Durable MCP

Durable MCP extends the base MCP functionality with Cloudflare's Durable Objects, providing:

- Persistent state management for your MCP server
- Secure storage of authentication context between requests
- Access to authenticated user information via `this.props`
- Support for conditional tool availability based on user identity

#### MCP Remote

The MCP Remote library enables your server to expose tools that can be invoked by MCP clients like the Inspector. It:

- Defines the protocol for communication between clients and your server
- Provides a structured way to define tools
- Handles serialization and deserialization of requests and responses
- Maintains the Server-Sent Events (SSE) connection between clients and your server
