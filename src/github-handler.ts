import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { Octokit } from "octokit";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props } from "./utils";
import {
	clientIdAlreadyApproved,
	parseRedirectApproval,
	renderApprovalDialog,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/.well-known/oauth-protected-resource", (c) => {
	const url = new URL(c.req.url);
	const as_metadata_url = `${url.protocol}//${url.host}/.well-known/oauth-authorization-server`;
	return c.json({
		authorization_servers: [as_metadata_url],
	});
});

app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	if (
		await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, env.COOKIE_ENCRYPTION_KEY)
	) {
		return redirectToGithub(c.req.raw, oauthReqInfo);
	}

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		server: {
			description: "This is a demo MCP Remote Server using GitHub for authentication.",
			logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
			name: "Cloudflare GitHub MCP Server", // optional
		},
		state: { oauthReqInfo }, // arbitrary data that flows through the form submission below
	});
});

app.post("/authorize", async (c) => {
	// Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
	const { state, headers } = await parseRedirectApproval(c.req.raw, env.COOKIE_ENCRYPTION_KEY);
	if (!state.oauthReqInfo) {
		return c.text("Invalid request", 400);
	}

	return redirectToGithub(c.req.raw, state.oauthReqInfo, headers);
});

async function redirectToGithub(
	request: Request,
	oauthReqInfo: AuthRequest,
	headers: Record<string, string> = {},
) {
	return new Response(null, {
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				client_id: env.GITHUB_CLIENT_ID,
				redirect_uri: new URL("/callback", request.url).href,
				scope: "read:user",
				state: btoa(JSON.stringify(oauthReqInfo)),
				upstream_url: "https://github.com/login/oauth/authorize",
			}),
		},
		status: 302,
	});
}

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from GitHub after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get("/callback", async (c) => {
	console.log("[CALLBACK] Incoming request", {
		query: Object.fromEntries(new URL(c.req.url).searchParams),
		headers: Object.fromEntries(c.req.raw.headers),
	});
	try {
	// Get the oathReqInfo out of KV
			const stateParam = c.req.query("state");
		console.log("[CALLBACK] Decoding state param", { stateParam });
		const oauthReqInfo = JSON.parse(atob(stateParam as string)) as AuthRequest;
		console.log("[CALLBACK] Decoded oauthReqInfo", { oauthReqInfo });
			if (!oauthReqInfo.clientId) {
					console.error("[CALLBACK] Invalid state: missing clientId", { oauthReqInfo });
			return c.text("Invalid state", 400);
	}

	// Exchange the code for an access token
			console.log("[CALLBACK] Exchanging code for access token", {
			client_id: c.env.GITHUB_CLIENT_ID,
			code: c.req.query("code"),
		});
		const [accessToken, errResponse] = await fetchUpstreamAuthToken({
		client_id: c.env.GITHUB_CLIENT_ID,
		client_secret: c.env.GITHUB_CLIENT_SECRET,
		code: c.req.query("code"),
		redirect_uri: new URL("/callback", c.req.url).href,
		upstream_url: "https://github.com/login/oauth/access_token",
	});
			if (errResponse) {
			console.error("[CALLBACK] Error fetching access token", { errResponse });
			return errResponse;
		}

	// Fetch the user info from GitHub
			console.log("[CALLBACK] Fetching user info from GitHub", { accessToken: !!accessToken });
		const user = await new Octokit({ auth: accessToken }).rest.users.getAuthenticated();
			console.log("[CALLBACK] GitHub user fetched", { user: user.data });
		const { login, name, email } = user.data;

	// Return back to the MCP client a new token
			console.log("[CALLBACK] Completing authorization with OAUTH_PROVIDER", { login, name, email });
		console.log("[CALLBACK] About to call completeAuthorization", {
			query: Object.fromEntries(new URL(c.req.url).searchParams),
			headers: Object.fromEntries(c.req.raw.headers),
			oauthReqInfo
		});
		const result = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: {
			label: name,
		},
		// This will be available on this.props inside MyMCP
		props: {
			accessToken,
			email,
			login,
			name,
		} as Props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: login,
	});
		const { redirectTo } = result;
		console.log("[CALLBACK] completeAuthorization result", { result });
		console.log("[CALLBACK] Redirecting to MCP client", { redirectTo });
		return Response.redirect(redirectTo);
	} catch (err) {
		console.error("[CALLBACK] Uncaught error in /callback handler", { error: err });
		return new Response("Internal Server Error", { status: 500 });
	}
});

export { app as GitHubHandler };
