const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const SESSION_COOKIE = "mjt_session";
const STATE_COOKIE = "mjt_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const STATE_TTL_SECONDS = 60 * 5;

type SameSite = "Strict" | "Lax" | "None";

interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  path?: string;
  maxAge?: number;
  sameSite?: SameSite;
}

type SessionPayload = {
  login: string;
  id: number;
  name?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  exp: number;
};

type StatePayload = {
  nonce: string;
  redirect: string;
  createdAt: number;
};

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_SECRET?: string;
  COOKIE_ENCRYPTION_KEY?: string;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (!keyCache.has(secret)) {
    const keyPromise = crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keyCache.set(secret, keyPromise);
  }
  return keyCache.get(secret)!;
}

function base64UrlEncode(source: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof source === "string") {
    bytes = textEncoder.encode(source);
  } else if (source instanceof Uint8Array) {
    bytes = source;
  } else {
    bytes = new Uint8Array(source);
  }

  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(padding);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return base64UrlEncode(signature);
}

async function verify(secret: string, payload: string, signature: string): Promise<boolean> {
  const key = await importHmacKey(secret);
  const decodedSignature = base64UrlDecode(signature);
  return crypto.subtle.verify("HMAC", key, decodedSignature, textEncoder.encode(payload));
}

async function encodeSignedPayload(secret: string, data: unknown): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify(data));
  const signature = await sign(secret, payload);
  return `${payload}.${signature}`;
}

async function decodeSignedPayload<T>(secret: string, token: string): Promise<T | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }

  const isValid = await verify(secret, payload, signature);
  if (!isValid) {
    return null;
  }

  try {
    const jsonString = textDecoder.decode(base64UrlDecode(payload));
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error("Failed to parse signed payload", error);
    return null;
  }
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  return header.split(";").reduce<Record<string, string>>((acc, pair) => {
    const [namePart, ...valueParts] = pair.split("=");
    if (!namePart || valueParts.length === 0) {
      return acc;
    }
    const name = namePart.trim();
    const value = valueParts.join("=").trim();
    if (name) {
      acc[name] = value;
    }
    return acc;
  }, {});
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const segments: string[] = [`${name}=${value}`];
  if (options.maxAge !== undefined) {
    segments.push(`Max-Age=${options.maxAge}`);
    const expiry = new Date(Date.now() + options.maxAge * 1000);
    segments.push(`Expires=${expiry.toUTCString()}`);
  }
  segments.push(`Path=${options.path ?? "/"}`);
  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  }
  if (options.httpOnly) {
    segments.push("HttpOnly");
  }
  if (options.secure) {
    segments.push("Secure");
  }
  return segments.join("; ");
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function getCookieSecret(env: Env): string {
  const secret = env.COOKIE_SECRET ?? env.COOKIE_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("COOKIE_SECRET or COOKIE_ENCRYPTION_KEY must be configured");
  }
  return secret;
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function normalizeRedirectTarget(target: string | null | undefined): string {
  if (typeof target !== "string" || target.length === 0) {
    return "/";
  }

  if (!target.startsWith("/")) {
    return "/";
  }

  if (target.startsWith("/api/auth") || target.startsWith("/callback")) {
    return "/";
  }

  return target;
}

async function readSession(request: Request, env: Env): Promise<SessionPayload | null> {
  try {
    const cookies = parseCookies(request.headers.get("Cookie"));
    const sessionToken = cookies[SESSION_COOKIE];
    if (!sessionToken) {
      return null;
    }

    const payload = await decodeSignedPayload<SessionPayload>(getCookieSecret(env), sessionToken);
    if (!payload) {
      return null;
    }

    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    console.error("Failed to read session", error);
    return null;
  }
}

function isLocalHost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

function acceptsHtml(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").includes("text/html");
}

async function serveAsset(request: Request, env: Env, url: URL): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const hasFileExtension = /\.[^/]+$/.test(url.pathname);

  if (response.status === 404 && request.method === "GET" && !hasFileExtension && acceptsHtml(request)) {
    const rootUrl = new URL("/", url);
    return env.ASSETS.fetch(new Request(rootUrl.toString(), request));
  }

  return response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    console.log("[oauth] request", { pathname: url.pathname, method: request.method, search: url.search });

    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const session = await readSession(request, env);
      if (!session) {
        return jsonResponse({ authenticated: false });
      }
      return jsonResponse({ authenticated: true, user: session });
    }

    if (url.pathname === "/api/auth/login" && request.method === "GET") {
      if (!env.GITHUB_CLIENT_ID) {
        return jsonResponse({ error: "GitHub OAuth is not configured" }, { status: 500 });
      }

      const redirectTarget = normalizeRedirectTarget(url.searchParams.get("redirect"));
      const nonce = randomToken(32);

      console.log("[oauth] begin login", {
        redirectTarget,
        origin: url.origin,
        hasClientId: Boolean(env.GITHUB_CLIENT_ID),
      });

      const statePayload: StatePayload = {
        nonce,
        redirect: redirectTarget,
        createdAt: Date.now(),
      };

      const stateCookieValue = await encodeSignedPayload(getCookieSecret(env), statePayload);

      const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
      authorizeUrl.searchParams.set("state", nonce);
      authorizeUrl.searchParams.set("scope", "read:user user:email");
      authorizeUrl.searchParams.set("allow_signup", "false");

      const response = new Response(null, {
        status: 302,
        headers: {
          Location: authorizeUrl.toString(),
        },
      });
      response.headers.append(
        "Set-Cookie",
        serializeCookie(STATE_COOKIE, stateCookieValue, {
          httpOnly: true,
          secure: !isLocalHost(url),
          sameSite: "Lax",
          maxAge: STATE_TTL_SECONDS,
        }),
      );
      console.log("[oauth] redirecting to github", authorizeUrl.toString());
      return response;
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const response = jsonResponse({ ok: true });
      response.headers.append(
        "Set-Cookie",
        serializeCookie(SESSION_COOKIE, "", {
          httpOnly: true,
          secure: !isLocalHost(url),
          sameSite: "Lax",
          maxAge: 0,
        }),
      );
      return response;
    }

    if (url.pathname === "/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return jsonResponse({ error: "Invalid OAuth response" }, { status: 400 });
      }

      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        return jsonResponse({ error: "GitHub OAuth is not configured" }, { status: 500 });
      }

      const cookies = parseCookies(request.headers.get("Cookie"));
      const stateCookie = cookies[STATE_COOKIE];
      if (!stateCookie) {
        return jsonResponse({ error: "OAuth state cookie is missing" }, { status: 400 });
      }

      const parsedState = await decodeSignedPayload<StatePayload>(getCookieSecret(env), stateCookie);
      if (!parsedState || parsedState.nonce !== state) {
        return jsonResponse({ error: "OAuth state validation failed" }, { status: 400 });
      }

      if (Date.now() - parsedState.createdAt > STATE_TTL_SECONDS * 1000) {
        return jsonResponse({ error: "OAuth state is expired" }, { status: 400 });
      }

      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "mcp-jira-thing-oauth",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/callback`,
        }),
      });

      if (!tokenResponse.ok) {
        const text = await tokenResponse.text();
        console.error("GitHub token exchange failed", tokenResponse.status, text);
        return jsonResponse({ error: "Failed to exchange OAuth code" }, { status: 502 });
      }

      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
        token_type?: string;
        scope?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenPayload.access_token) {
        console.error("GitHub token payload missing access token", tokenPayload);
        return jsonResponse({ error: "GitHub did not return an access token" }, { status: 502 });
      }

      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenPayload.access_token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "mcp-jira-thing-oauth",
        },
      });

      if (!userResponse.ok) {
        const text = await userResponse.text();
        console.error("GitHub user fetch failed", userResponse.status, text);
        return jsonResponse({ error: "Failed to fetch GitHub profile" }, { status: 502 });
      }

      const userData = (await userResponse.json()) as {
        id: number;
        login: string;
        name?: string | null;
        avatar_url?: string | null;
        email?: string | null;
      };

      let primaryEmail: string | null | undefined = userData.email ?? null;
      if (!primaryEmail) {
        const emailResponse = await fetch("https://api.github.com/user/emails", {
          headers: {
            Authorization: `Bearer ${tokenPayload.access_token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "mcp-jira-thing-oauth",
          },
        });

        if (emailResponse.ok) {
          const emails = (await emailResponse.json()) as Array<{
            email: string;
            primary?: boolean;
            verified?: boolean;
          }>;
          const preferred = emails.find((item) => item.primary && item.verified) ?? emails.find((item) => item.primary) ?? emails[0];
          primaryEmail = preferred?.email ?? null;
        }
      }

      const sessionPayload: SessionPayload = {
        login: userData.login,
        id: userData.id,
        name: userData.name ?? null,
        avatarUrl: userData.avatar_url ?? null,
        email: primaryEmail ?? null,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
      };

      const sessionCookieValue = await encodeSignedPayload(getCookieSecret(env), sessionPayload);
      const redirectTarget = normalizeRedirectTarget(parsedState.redirect) || "/";

      const response = new Response(null, {
        status: 303,
        headers: {
          Location: redirectTarget,
        },
      });
      response.headers.append(
        "Set-Cookie",
        serializeCookie(SESSION_COOKIE, sessionCookieValue, {
          httpOnly: true,
          secure: !isLocalHost(url),
          sameSite: "Lax",
          maxAge: SESSION_TTL_SECONDS,
        }),
      );
      response.headers.append(
        "Set-Cookie",
        serializeCookie(STATE_COOKIE, "", {
          httpOnly: true,
          secure: !isLocalHost(url),
          sameSite: "Lax",
          maxAge: 0,
        }),
      );
      return response;
    }

    return serveAsset(request, env, url);
  },
};
