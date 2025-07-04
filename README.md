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

## Configuration and Deployment

Follow these steps to configure and deploy your MCP server.

### 1. Create a GitHub OAuth App

First, you need to create a [GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) to get your client credentials.

-   **Homepage URL**: `https://<your-worker-name>.<your-subdomain>.workers.dev`
-   **Authorization callback URL**: `https://<your-worker-name>.<your-subdomain>.workers.dev/callback`

Once the app is created, note the **Client ID** and generate a new **Client secret**.

### 2. Configure Secrets

Next, use Wrangler to securely store your GitHub credentials and a session encryption key as secrets.

```bash
# Will prompt for your GitHub Client ID
npx wrangler secret put GITHUB_CLIENT_ID

# Will prompt for your GitHub Client Secret
npx wrangler secret put GITHUB_CLIENT_SECRET

# Will prompt for a random string to encrypt cookies
npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

For the `COOKIE_ENCRYPTION_KEY`, you can generate a secure random string with `openssl rand -hex 32`.

### 3. Set up a KV Namespace

This project uses a KV namespace to store OAuth-related data.

1.  **Create the KV namespace:**
    ```bash
    npx wrangler kv:namespace create "OAUTH_KV"
    ```
2.  **Update `wrangler.jsonc`:** Wrangler will output a binding and an ID. Add the `kv_namespaces` configuration to your `wrangler.jsonc` file, replacing the `id` with the one you received:
    ```json
    "kv_namespaces": [
        {
            "binding": "OAUTH_KV",
            "id": "your-kv-namespace-id-here"
        }
    ]
    ```

### 4. Authorize Users

To grant access to restricted tools like `generateImage`, you must add the GitHub usernames of authorized users to the `ALLOWED_USERNAMES` set in `src/index.ts`.

```typescript
// src/index.ts
const ALLOWED_USERNAMES = new Set<string>([
	'PortNumber53',
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

-   **`add`**
    -   **Description**: Adds two numbers.
    -   **Access**: Public (available to all authenticated users).
    -   **Parameters**: `a` (number), `b` (number).

-   **`generateImage`**
    -   **Description**: Generates an image using the `@cf/black-forest-labs/flux-1-schnell` model.
    -   **Access**: Restricted (only available to users in `ALLOWED_USERNAMES`).
    -   **Parameters**: `prompt` (string), `steps` (number, 4-8).

## Usage

You can test your remote server using the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector@latest
```

Enter your worker's SSE URL (`https://<your-worker-name>.<your-subdomain>.workers.dev/sse`) and click **Connect**. You will be redirected to GitHub to authenticate. Once authenticated, you will see the available tools in the Inspector.

<img width="640" alt="MCP Inspector showing available tools" src="https://github.com/user-attachments/assets/7973f392-0a9d-4712-b679-6dd23f824287" />

## Project Structure

-   `src/index.ts`: The main entry point for the Cloudflare Worker. Defines the MCP server, its tools, and the logic for conditional tool access.
-   `src/github-handler.ts`: Contains the logic for handling the GitHub OAuth flow.
-   `src/workers-oauth-utils.ts`: Provides utility functions for the OAuth process, adapted from the `workers-oauth-provider` library.
-   `wrangler.jsonc`: The configuration file for the Cloudflare Worker.
-   `package.json`: Defines project scripts and dependencies.

You now have a remote MCP server deployed!

### Access Control

This MCP server uses GitHub OAuth for authentication. All authenticated GitHub users can access basic tools like "add" and "userInfoOctokit".

The "generateImage" tool is restricted to specific GitHub users listed in the `ALLOWED_USERNAMES` configuration:

```typescript
// Add GitHub usernames for image generation access
const ALLOWED_USERNAMES = new Set([
  'yourusername',
  'teammate1'
]);
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
- For the Homepage URL, specify `http://localhost:8788`
- For the Authorization callback URL, specify `http://localhost:8788/callback`
- Note your Client ID and generate a Client secret.
- Create a `.dev.vars` file in your project root with:
```
GITHUB_CLIENT_ID=your_development_github_client_id
GITHUB_CLIENT_SECRET=your_development_github_client_secret
```

#### Develop & Test
Run the server locally to make it available at `http://localhost:8788`
`wrangler dev`

To test the local server, enter `http://localhost:8788/sse` into Inspector and hit connect. Once you follow the prompts, you'll be able to "List Tools".

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
