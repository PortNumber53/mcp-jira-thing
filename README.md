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

## Go Backend (`backend/`)

The Go backend exposes REST endpoints that read from our Xata database and serve the data to the frontend (or other consumers). The initial implementation ships with:

- `GET /healthz` — simple health probe for load balancers and Jenkins smoke checks.
- `GET /api/users?limit=50` — returns a paginated list of NextAuth users pulled from Xata.

### Environment variables

Create a copy of `backend/.env.example` and provide the required values:

| Variable                       | Required | Description                                                   |
| ------------------------------ | -------- | ------------------------------------------------------------- |
| `BACKEND_ADDR`                 | optional | Address the HTTP server listens on. Defaults to `:18111`.      |
| `XATA_API_KEY`                 | ✅       | Xata API key with read access to the `dbjirathing` database.  |
| `XATA_WORKSPACE`               | ✅       | Workspace slug (e.g. `acme-labs`).                            |
| `XATA_DATABASE`                | ✅       | Database name (`dbjirathing`).                                |
| `XATA_BRANCH`                  | optional | Database branch, defaults to `main`.                          |
| `XATA_REGION`                  | optional | Workspace region (e.g. `us-east-1`); defaults to `us-east-1`. |
| `BACKEND_HTTP_TIMEOUT_SECONDS` | optional | Outbound request timeout, defaults to 15 seconds.             |

If you already have a PostgreSQL-style `DATABASE_URL` from Xata (e.g. `postgresql://workspace:<API_KEY>@us-east-1.sql.xata.sh/dbjirathing:main?sslmode=require`) you can simply set that single environment variable—the backend will parse it automatically and populate the individual settings.

To populate `.env` manually from the URL you can parse it with a small helper script:

```bash
# Example DATABASE_URL
database_url='postgresql://workspace:<API_KEY>@us-east-1.sql.xata.sh/dbjirathing:main?sslmode=require'

python3 - <<'PY'
import os
import urllib.parse

url = urllib.parse.urlparse(os.environ.get('database_url') or os.environ.get('DATABASE_URL'))
if not url.username or not url.password:
    raise SystemExit("DATABASE_URL must include username (workspace) and password (API key)")

database, _, branch = url.path.lstrip('/').partition(':')
branch = branch or 'main'

print(f"export XATA_WORKSPACE={url.username}")
print(f"export XATA_API_KEY={url.password}")
print(f"export XATA_DATABASE={database}")
print(f"export XATA_BRANCH={branch}")
PY
```

`go test` and the runtime code expect the environment variables to be present. When running locally you can export them or use a dotenv loader (`direnv`, `dotenvx`, etc.).

### Local development

```bash
cd backend
cp .env.example .env   # edit with your credentials (or export env vars)
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
- **Authorization callback URL**: `https://<your-worker-name>.<your-subdomain>.workers.dev/callback`

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
- For the Authorization callback URL, specify `http://localhost:18112/callback`
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
