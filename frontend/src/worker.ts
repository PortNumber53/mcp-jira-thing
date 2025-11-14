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
  linkAccount?: boolean;
};

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  COOKIE_SECRET?: string;
  SESSION_SECRET?: string;
  BACKEND_BASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  DATABASE_URL?: string;
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

async function verifyStripeWebhook(payload: string, signature: string, secret: string): Promise<any> {
  // Stripe signature format: t=timestamp,v1=signature1,v0=signature0
  const signatureParts = signature.split(",");
  const timestamp = signatureParts.find((part) => part.startsWith("t="))?.split("=")[1];
  const v1Signature = signatureParts.find((part) => part.startsWith("v1="))?.split("=")[1];

  if (!timestamp || !v1Signature) {
    throw new Error("Invalid signature format");
  }

  // Check timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const timestampNum = parseInt(timestamp, 10);
  if (now - timestampNum > 300) {
    throw new Error("Webhook timestamp too old");
  }

  // Construct signed payload
  const signedPayload = `${timestamp}.${payload}`;

  // Compute expected signature
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expectedSignatureBuffer = await crypto.subtle.sign("HMAC", key, textEncoder.encode(signedPayload));
  const expectedSignature = Array.from(new Uint8Array(expectedSignatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Compare signatures (constant-time comparison)
  if (expectedSignature !== v1Signature) {
    throw new Error("Invalid signature");
  }

  // Parse and return the event
  return JSON.parse(payload);
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

let emittedLegacySecretWarning = false;
let emittedCookieSecretHint = false;

function getCookieSecret(env: Env): string {
  const secret = env.COOKIE_SECRET ?? env.SESSION_SECRET;
  if (secret) {
    if (!env.SESSION_SECRET && env.COOKIE_SECRET && !emittedCookieSecretHint) {
      console.warn("[oauth] Using COOKIE_SECRET; consider consolidating on SESSION_SECRET for clarity.");
      emittedCookieSecretHint = true;
    }
    return secret;
  }

  const legacySecret = (env as { COOKIE_ENCRYPTION_KEY?: string }).COOKIE_ENCRYPTION_KEY;
  if (legacySecret) {
    if (!emittedLegacySecretWarning) {
      console.warn("[oauth] COOKIE_ENCRYPTION_KEY is deprecated. Please rename this secret to SESSION_SECRET to avoid confusion.");
      emittedLegacySecretWarning = true;
    }
    return legacySecret;
  }

  throw new Error("COOKIE_SECRET or SESSION_SECRET must be configured");
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
      const linkAccount = url.searchParams.get("link") === "true";
      const nonce = randomToken(32);

      const statePayload: StatePayload = {
        nonce,
        redirect: redirectTarget,
        createdAt: Date.now(),
        linkAccount,
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
      return response;
    }

    if (url.pathname === "/api/auth/google/login" && request.method === "GET") {
      if (!env.GOOGLE_CLIENT_ID) {
        return jsonResponse({ error: "Google OAuth is not configured" }, { status: 500 });
      }

      const redirectTarget = normalizeRedirectTarget(url.searchParams.get("redirect"));
      const linkAccount = url.searchParams.get("link") === "true";
      const nonce = randomToken(32);

      const statePayload: StatePayload = {
        nonce,
        redirect: redirectTarget,
        createdAt: Date.now(),
        linkAccount,
      };

      const stateCookieValue = await encodeSignedPayload(getCookieSecret(env), statePayload);

      const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorizeUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", `${url.origin}/google/callback`);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", "openid email profile");
      authorizeUrl.searchParams.set("state", nonce);
      // Always show the Google account chooser so you can switch accounts
      authorizeUrl.searchParams.set("prompt", "select_account");

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
      return response;
    }

    if (url.pathname === "/api/auth/connected-accounts" && request.method === "GET") {
      const session = await readSession(request, env);
      if (!session) {
        return jsonResponse({ error: "Not authenticated" }, { status: 401 });
      }

      if (!env.BACKEND_BASE_URL) {
        return jsonResponse({ error: "Backend is not configured" }, { status: 500 });
      }

      const backendUrl = new URL("/api/auth/connected-accounts", env.BACKEND_BASE_URL);
      if (session.email) {
        backendUrl.searchParams.set("email", session.email);
      }

      const upstreamResp = await fetch(backendUrl.toString(), { method: "GET" });
      const text = await upstreamResp.text();

      if (!upstreamResp.ok) {
        console.error("Backend connected accounts fetch failed", {
          status: upstreamResp.status,
          body: text,
        });
        return new Response(text || "Failed to load connected accounts", {
          status: upstreamResp.status,
          headers: {
            "Content-Type": upstreamResp.headers.get("Content-Type") || "text/plain",
          },
        });
      }

      return new Response(text, {
        status: upstreamResp.status,
        headers: {
          "Content-Type": upstreamResp.headers.get("Content-Type") || "application/json; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/api/settings/jira") {
      const session = await readSession(request, env);
      if (!session) {
        return jsonResponse({ error: "Not authenticated" }, { status: 401 });
      }

      if (!env.BACKEND_BASE_URL) {
        return jsonResponse({ error: "Backend is not configured" }, { status: 500 });
      }

      const backendUrl = new URL("/api/settings/jira", env.BACKEND_BASE_URL);

      if (request.method === "POST") {
        let body: { jira_base_url?: string; jira_email?: string; atlassian_api_key?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch (error) {
          console.error("Failed to parse Jira settings payload", error);
          return jsonResponse({ error: "Invalid JSON payload" }, { status: 400 });
        }

        if (!body.jira_base_url || !body.jira_email || !body.atlassian_api_key) {
          return jsonResponse({ error: "Missing required fields" }, { status: 400 });
        }

        const payload: Record<string, unknown> = {
          jira_base_url: body.jira_base_url,
          jira_email: body.jira_email,
          atlassian_api_key: body.atlassian_api_key,
        };

        if (session.email) {
          payload.user_email = session.email;
        }

        const upstreamResp = await fetch(backendUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const text = await upstreamResp.text();
        if (!upstreamResp.ok) {
          console.error("Backend Jira settings save failed", {
            status: upstreamResp.status,
            body: text,
          });
          return new Response(text || "Failed to persist Jira settings", {
            status: upstreamResp.status,
            headers: {
              "Content-Type": upstreamResp.headers.get("Content-Type") || "text/plain",
            },
          });
        }

        return new Response(text, {
          status: upstreamResp.status,
          headers: {
            "Content-Type": upstreamResp.headers.get("Content-Type") || "application/json; charset=utf-8",
          },
        });
      }

      if (request.method === "GET") {
        const urlWithEmail = new URL(backendUrl.toString());
        if (session.email) {
          urlWithEmail.searchParams.set("email", session.email);
        }

        const upstreamResp = await fetch(urlWithEmail.toString(), {
          method: "GET",
        });

        const text = await upstreamResp.text();
        if (!upstreamResp.ok) {
          console.error("Backend Jira settings load failed", {
            status: upstreamResp.status,
            body: text,
          });
          return new Response(text || "Failed to load Jira settings", {
            status: upstreamResp.status,
            headers: {
              "Content-Type": upstreamResp.headers.get("Content-Type") || "text/plain",
            },
          });
        }

        return new Response(text, {
          status: upstreamResp.status,
          headers: {
            "Content-Type": upstreamResp.headers.get("Content-Type") || "application/json; charset=utf-8",
          },
        });
      }

      return jsonResponse({ error: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname === "/api/mcp/secret") {
      const session = await readSession(request, env);
      if (!session) {
        return jsonResponse({ error: "Not authenticated" }, { status: 401 });
      }

      if (!env.BACKEND_BASE_URL) {
        return jsonResponse({ error: "Backend is not configured" }, { status: 500 });
      }

      const backendUrl = new URL("/api/mcp/secret", env.BACKEND_BASE_URL);

      if (request.method === "GET") {
        const urlWithEmail = new URL(backendUrl.toString());
        if (session.email) {
          urlWithEmail.searchParams.set("email", session.email);
        }

        const upstreamResp = await fetch(urlWithEmail.toString(), { method: "GET" });
        const text = await upstreamResp.text();
        if (!upstreamResp.ok) {
          console.error("Backend MCP secret load failed", {
            status: upstreamResp.status,
            body: text,
          });
          return new Response(text || "Failed to load MCP secret", {
            status: upstreamResp.status,
            headers: {
              "Content-Type": upstreamResp.headers.get("Content-Type") || "text/plain",
            },
          });
        }

        return new Response(text, {
          status: upstreamResp.status,
          headers: {
            "Content-Type": upstreamResp.headers.get("Content-Type") || "application/json; charset=utf-8",
          },
        });
      }

      if (request.method === "POST") {
        const payload: { user_email?: string } = {};
        if (session.email) {
          payload.user_email = session.email;
        }

        const upstreamResp = await fetch(backendUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const text = await upstreamResp.text();
        if (!upstreamResp.ok) {
          console.error("Backend MCP secret rotate failed", {
            status: upstreamResp.status,
            body: text,
          });
          return new Response(text || "Failed to generate MCP secret", {
            status: upstreamResp.status,
            headers: {
              "Content-Type": upstreamResp.headers.get("Content-Type") || "text/plain",
            },
          });
        }

        return new Response(text, {
          status: upstreamResp.status,
          headers: {
            "Content-Type": upstreamResp.headers.get("Content-Type") || "application/json; charset=utf-8",
          },
        });
      }

      return jsonResponse({ error: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname === "/api/billing/create-subscription" && request.method === "POST") {
      const session = await readSession(request, env);
      if (!session) {
        return jsonResponse({ error: "Not authenticated" }, { status: 401 });
      }

      if (!env.STRIPE_SECRET_KEY) {
        return jsonResponse({ error: "Stripe is not configured" }, { status: 500 });
      }

      if (!env.STRIPE_PRICE_ID) {
        return jsonResponse({ error: "Stripe price ID is not configured" }, { status: 500 });
      }

      try {
        const body = await request.json() as { paymentMethodId: string };
        const { paymentMethodId } = body;

        if (!paymentMethodId) {
          return jsonResponse({ error: "Payment method ID is required" }, { status: 400 });
        }

        // Create or retrieve Stripe customer
        const customerParams = new URLSearchParams({
          email: session.email || "",
          name: session.name || session.login,
        });
        customerParams.append('metadata[user_id]', session.id.toString());
        customerParams.append('metadata[github_login]', session.login);

        const customerResponse = await fetch("https://api.stripe.com/v1/customers", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: customerParams,
        });

        if (!customerResponse.ok) {
          const errorText = await customerResponse.text();
          console.error("Failed to create Stripe customer:", errorText);
          return jsonResponse({ error: "Failed to create customer" }, { status: 500 });
        }

        const customer = await customerResponse.json() as { id: string };

        // Attach payment method to customer
        await fetch(`https://api.stripe.com/v1/payment_methods/${paymentMethodId}/attach`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            customer: customer.id,
          }),
        });

        // Set as default payment method
        await fetch(`https://api.stripe.com/v1/customers/${customer.id}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            'invoice_settings[default_payment_method]': paymentMethodId,
          }),
        });

        // Create subscription
        const subscriptionParams = new URLSearchParams({
          customer: customer.id,
          'items[0][price]': env.STRIPE_PRICE_ID,
          'expand[0]': 'latest_invoice.payment_intent',
        });

        const subscriptionResponse = await fetch("https://api.stripe.com/v1/subscriptions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: subscriptionParams,
        });

        if (!subscriptionResponse.ok) {
          const errorText = await subscriptionResponse.text();
          console.error("Failed to create subscription:", errorText);
          return jsonResponse({ error: "Failed to create subscription" }, { status: 500 });
        }

        const subscription = await subscriptionResponse.json();

        // Save subscription to backend database
        if (env.BACKEND_BASE_URL) {
          try {
            await fetch(`${env.BACKEND_BASE_URL}/api/billing/save-subscription`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                user_email: session.email,
                stripe_customer_id: customer.id,
                stripe_subscription_id: subscription.id,
                stripe_price_id: env.STRIPE_PRICE_ID,
                status: subscription.status,
                current_period_start: subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
                current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
              }),
            });
          } catch (dbError) {
            console.error("Failed to save subscription to database:", dbError);
            // Don't fail the request if database save fails
          }
        }

        return jsonResponse({
          subscriptionId: subscription.id,
          clientSecret: subscription.latest_invoice?.payment_intent?.client_secret,
        });
      } catch (error) {
        console.error("Subscription creation error:", error);
        return jsonResponse({ error: "An error occurred while processing your subscription" }, { status: 500 });
      }
    }

    if (url.pathname === "/api/billing/cancel-subscription" && request.method === "POST") {
      const session = await readSession(request, env);
      if (!session) {
        return jsonResponse({ error: "Not authenticated" }, { status: 401 });
      }

      if (!env.STRIPE_SECRET_KEY) {
        return jsonResponse({ error: "Stripe is not configured" }, { status: 500 });
      }

      try {
        const body = await request.json() as { subscriptionId: string };
        const { subscriptionId } = body;

        if (!subscriptionId) {
          return jsonResponse({ error: "Subscription ID is required" }, { status: 400 });
        }

        // First, retrieve the subscription to check its current status
        const getSubscriptionResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
          },
        });

        if (!getSubscriptionResponse.ok) {
          const errorText = await getSubscriptionResponse.text();
          console.error("Failed to retrieve subscription:", errorText);

          // Check if subscription not found (might have been deleted)
          if (getSubscriptionResponse.status === 404) {
            return jsonResponse({
              error: "Subscription not found. It may have already been canceled.",
              code: "subscription_not_found"
            }, { status: 404 });
          }

          return jsonResponse({ error: "Failed to retrieve subscription" }, { status: 500 });
        }

        const existingSubscription = await getSubscriptionResponse.json();

        // Check if already canceled - sync to database
        if (existingSubscription.status === "canceled") {
          // Update database with cancellation data
          if (env.BACKEND_BASE_URL) {
            try {
              // Get customer email
              const customerResponse = await fetch(
                `https://api.stripe.com/v1/customers/${existingSubscription.customer}`,
                {
                  headers: {
                    "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
                  },
                }
              );

              if (customerResponse.ok) {
                const customer = await customerResponse.json();

                const syncPayload = {
                  user_email: customer.email,
                  stripe_customer_id: existingSubscription.customer,
                  stripe_subscription_id: existingSubscription.id,
                  stripe_price_id: existingSubscription.items.data[0]?.price?.id,
                  status: existingSubscription.status,
                  current_period_start: existingSubscription.current_period_start
                    ? new Date(existingSubscription.current_period_start * 1000).toISOString()
                    : null,
                  current_period_end: existingSubscription.current_period_end
                    ? new Date(existingSubscription.current_period_end * 1000).toISOString()
                    : null,
                  cancel_at_period_end: existingSubscription.cancel_at_period_end || false,
                  canceled_at: existingSubscription.canceled_at
                    ? new Date(existingSubscription.canceled_at * 1000).toISOString()
                    : null,
                };

                console.log("Syncing canceled subscription to database:", JSON.stringify(syncPayload, null, 2));

                const syncResponse = await fetch(`${env.BACKEND_BASE_URL}/api/billing/save-subscription`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(syncPayload),
                });

                const syncResult = await syncResponse.text();
                console.log("Sync response:", syncResponse.status, syncResult);

                if (syncResponse.ok) {
                  console.log("Successfully synced canceled subscription to database:", existingSubscription.id);
                } else {
                  console.error("Failed to sync - backend returned:", syncResponse.status, syncResult);
                }
              }
            } catch (error) {
              console.error("Failed to sync canceled subscription to database:", error);
            }
          }

          return jsonResponse({
            message: "Subscription is already canceled",
            subscription: existingSubscription,
          });
        }

        // Check if already set to cancel at period end - sync to database
        if (existingSubscription.cancel_at_period_end) {
          // Update database with cancel_at_period_end flag
          if (env.BACKEND_BASE_URL) {
            try {
              const customerResponse = await fetch(
                `https://api.stripe.com/v1/customers/${existingSubscription.customer}`,
                {
                  headers: {
                    "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
                  },
                }
              );

              if (customerResponse.ok) {
                const customer = await customerResponse.json();

                const syncPayload = {
                  user_email: customer.email,
                  stripe_customer_id: existingSubscription.customer,
                  stripe_subscription_id: existingSubscription.id,
                  stripe_price_id: existingSubscription.items.data[0]?.price?.id,
                  status: existingSubscription.status,
                  current_period_start: existingSubscription.current_period_start
                    ? new Date(existingSubscription.current_period_start * 1000).toISOString()
                    : null,
                  current_period_end: existingSubscription.current_period_end
                    ? new Date(existingSubscription.current_period_end * 1000).toISOString()
                    : null,
                  cancel_at_period_end: true,
                  canceled_at: existingSubscription.canceled_at
                    ? new Date(existingSubscription.canceled_at * 1000).toISOString()
                    : null,
                };

                console.log("Syncing cancel-at-period-end subscription to database:", JSON.stringify(syncPayload, null, 2));

                const syncResponse = await fetch(`${env.BACKEND_BASE_URL}/api/billing/save-subscription`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(syncPayload),
                });

                const syncResult = await syncResponse.text();
                console.log("Sync response:", syncResponse.status, syncResult);

                if (syncResponse.ok) {
                  console.log("Successfully synced cancel-at-period-end subscription to database:", existingSubscription.id);
                } else {
                  console.error("Failed to sync - backend returned:", syncResponse.status, syncResult);
                }
              }
            } catch (error) {
              console.error("Failed to sync cancel-at-period-end subscription to database:", error);
            }
          }

          return jsonResponse({
            message: "Subscription is already set to cancel at the end of the billing period",
            subscription: existingSubscription,
          });
        }

        // Cancel subscription at period end
        const cancelResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            cancel_at_period_end: "true",
          }),
        });

        if (!cancelResponse.ok) {
          const errorText = await cancelResponse.text();
          console.error("Failed to cancel subscription:", errorText);
          return jsonResponse({ error: "Failed to cancel subscription" }, { status: 500 });
        }

        const subscription = await cancelResponse.json();

        return jsonResponse({
          subscription,
          message: "Subscription will be canceled at the end of the billing period",
        });
      } catch (error) {
        console.error("Subscription cancellation error:", error);
        return jsonResponse({ error: "An error occurred while canceling your subscription" }, { status: 500 });
      }
    }

    if (url.pathname === "/webhook/stripe" && request.method === "POST") {
      if (!env.STRIPE_WEBHOOK_SECRET) {
        console.error("Stripe webhook secret not configured");
        return new Response("Webhook secret not configured", { status: 500 });
      }

      try {
        const body = await request.text();
        const signature = request.headers.get("stripe-signature");

        if (!signature) {
          return new Response("No signature", { status: 400 });
        }

        // Verify webhook signature
        const event = await verifyStripeWebhook(body, signature, env.STRIPE_WEBHOOK_SECRET);

        console.log("Webhook event received:", event.type);

        // Handle different event types
        switch (event.type) {
          case "customer.subscription.created":
          case "customer.subscription.updated": {
            const subscription = event.data.object;

            // Find user by stripe customer ID (we need to query the backend)
            if (env.BACKEND_BASE_URL) {
              try {
                // Extract user email from subscription metadata or customer
                const customerResponse = await fetch(
                  `https://api.stripe.com/v1/customers/${subscription.customer}`,
                  {
                    headers: {
                      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
                    },
                  }
                );

                if (customerResponse.ok) {
                  const customer = await customerResponse.json();

                  await fetch(`${env.BACKEND_BASE_URL}/api/billing/save-subscription`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      user_email: customer.email,
                      stripe_customer_id: subscription.customer,
                      stripe_subscription_id: subscription.id,
                      stripe_price_id: subscription.items.data[0]?.price?.id,
                      status: subscription.status,
                      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                    }),
                  });

                  console.log("Subscription saved to database:", subscription.id);
                }
              } catch (error) {
                console.error("Failed to save subscription from webhook:", error);
              }
            }
            break;
          }

          case "customer.subscription.deleted": {
            const subscription = event.data.object;
            console.log("Subscription deleted:", subscription.id);
            // You can add logic here to mark subscription as canceled in DB
            break;
          }

          case "invoice.payment_succeeded": {
            const invoice = event.data.object;

            if (env.BACKEND_BASE_URL) {
              try {
                // Get customer email
                const customerResponse = await fetch(
                  `https://api.stripe.com/v1/customers/${invoice.customer}`,
                  {
                    headers: {
                      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
                    },
                  }
                );

                if (customerResponse.ok) {
                  const customer = await customerResponse.json();

                  await fetch(`${env.BACKEND_BASE_URL}/api/billing/save-payment`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      user_email: customer.email,
                      stripe_customer_id: invoice.customer,
                      stripe_payment_intent_id: invoice.payment_intent,
                      stripe_invoice_id: invoice.id,
                      amount: invoice.amount_paid,
                      currency: invoice.currency,
                      status: "succeeded",
                      description: `Payment for invoice ${invoice.number || invoice.id}`,
                      receipt_url: invoice.hosted_invoice_url,
                    }),
                  });

                  console.log("Payment saved to database:", invoice.id);
                }
              } catch (error) {
                console.error("Failed to save payment from webhook:", error);
              }
            }
            break;
          }

          case "invoice.payment_failed": {
            const invoice = event.data.object;
            console.log("Payment failed for invoice:", invoice.id);

            if (env.BACKEND_BASE_URL) {
              try {
                const customerResponse = await fetch(
                  `https://api.stripe.com/v1/customers/${invoice.customer}`,
                  {
                    headers: {
                      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
                    },
                  }
                );

                if (customerResponse.ok) {
                  const customer = await customerResponse.json();

                  await fetch(`${env.BACKEND_BASE_URL}/api/billing/save-payment`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      user_email: customer.email,
                      stripe_customer_id: invoice.customer,
                      stripe_payment_intent_id: invoice.payment_intent,
                      stripe_invoice_id: invoice.id,
                      amount: invoice.amount_due,
                      currency: invoice.currency,
                      status: "failed",
                      description: `Failed payment for invoice ${invoice.number || invoice.id}`,
                      receipt_url: null,
                    }),
                  });

                  console.log("Failed payment saved to database:", invoice.id);
                }
              } catch (error) {
                console.error("Failed to save failed payment from webhook:", error);
              }
            }
            break;
          }

          default:
            console.log("Unhandled event type:", event.type);
        }

        return jsonResponse({ received: true });
      } catch (error) {
        console.error("Webhook error:", error);
        return new Response(error instanceof Error ? error.message : "Webhook handler failed", { status: 400 });
      }
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

    if (url.pathname === "/api/account/delete" && request.method === "POST") {
      const session = await readSession(request, env);
      if (!session) {
        return jsonResponse({ error: "Not authenticated" }, { status: 401 });
      }

      if (!env.BACKEND_BASE_URL) {
        return jsonResponse({ error: "Backend is not configured" }, { status: 500 });
      }

      try {
        const body = await request.json() as { email: string };
        if (!body.email || body.email !== session.email) {
          return jsonResponse({ error: "Invalid request" }, { status: 400 });
        }

        // Forward the deletion request to the backend
        const backendResponse = await fetch(`${env.BACKEND_BASE_URL}/api/account/delete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: body.email }),
        });

        if (!backendResponse.ok) {
          const errorText = await backendResponse.text();
          console.error(`[DeleteAccount] Backend error: ${backendResponse.status} - ${errorText}`);
          return jsonResponse({ error: "Failed to delete account" }, { status: backendResponse.status });
        }

        const result = await backendResponse.json();
        console.log(`[DeleteAccount] Successfully deleted account for user ${body.email}`);

        // Clear session cookie
        const response = jsonResponse(result);
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
      } catch (error) {
        console.error("[DeleteAccount] Error deleting account:", error);
        return jsonResponse({ error: "Failed to delete account" }, { status: 500 });
      }
    }

    if (url.pathname === "/google/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return jsonResponse({ error: "Invalid OAuth response" }, { status: 400 });
      }

      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return jsonResponse({ error: "Google OAuth is not configured" }, { status: 500 });
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

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          code,
          redirect_uri: `${url.origin}/google/callback`,
          grant_type: "authorization_code",
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const text = await tokenResponse.text();
        console.error("Google token exchange failed", tokenResponse.status, text);
        return jsonResponse({ error: "Failed to exchange OAuth code" }, { status: 502 });
      }

      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
        id_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenPayload.access_token) {
        console.error("Google token payload missing access token", tokenPayload);
        return jsonResponse({ error: "Google did not return an access token" }, { status: 502 });
      }

      const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: {
          Authorization: `Bearer ${tokenPayload.access_token}`,
        },
      });

      if (!userResponse.ok) {
        const text = await userResponse.text();
        console.error("Google userinfo fetch failed", userResponse.status, text);
        return jsonResponse({ error: "Failed to fetch Google profile" }, { status: 502 });
      }

      const userData = (await userResponse.json()) as {
        sub: string;
        name?: string;
        email?: string;
        picture?: string;
      };

      const email = userData.email ?? null;
      if (!email) {
        return jsonResponse({ error: "Google did not return an email" }, { status: 502 });
      }

      // If this is an account linking operation, preserve the existing session
      let sessionCookieValue: string;
      const redirectTarget = normalizeRedirectTarget(parsedState.redirect) || "/";

      if (parsedState.linkAccount) {
        // Keep the existing session - don't create a new one
        const existingSessionCookie = cookies[SESSION_COOKIE];
        if (existingSessionCookie) {
          // Verify the existing session email matches the new OAuth email
          const existingSession = await decodeSignedPayload<SessionPayload>(getCookieSecret(env), existingSessionCookie);

          if (existingSession && existingSession.email && email) {
            // Check if emails match (case-insensitive)
            if (existingSession.email.toLowerCase() !== email.toLowerCase()) {
              // Emails don't match - can't link accounts
              const errorUrl = new URL(redirectTarget, url.origin);
              errorUrl.searchParams.set("error", "email_mismatch");
              errorUrl.searchParams.set("existing_email", existingSession.email);
              errorUrl.searchParams.set("new_email", email);

              return new Response(null, {
                status: 303,
                headers: {
                  Location: errorUrl.toString(),
                },
              });
            }
          }

          sessionCookieValue = existingSessionCookie;
        } else {
          // No existing session, create a new one
          const sessionPayload: SessionPayload = {
            login: email,
            id: Date.now(),
            name: userData.name ?? null,
            avatarUrl: userData.picture ?? null,
            email,
            exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
          };
          sessionCookieValue = await encodeSignedPayload(getCookieSecret(env), sessionPayload);
        }
      } else {
        // Normal login - create a new session
        const sessionPayload: SessionPayload = {
          login: email,
          id: Date.now(),
          name: userData.name ?? null,
          avatarUrl: userData.picture ?? null,
          email,
          exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        };
        sessionCookieValue = await encodeSignedPayload(getCookieSecret(env), sessionPayload);
      }

      // Best-effort: synchronise the authenticated Google user into the backend
      // multi-tenant database. Failures here should not block login.
      if (env.BACKEND_BASE_URL && tokenPayload.access_token) {
        const backendUrl = new URL("/api/auth/google", env.BACKEND_BASE_URL);
        const body = JSON.stringify({
          sub: userData.sub,
          name: userData.name ?? null,
          email,
          avatar_url: userData.picture ?? null,
          access_token: tokenPayload.access_token,
        });

        try {
          const backendResponse = await fetch(backendUrl.toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body,
          });
          if (!backendResponse.ok) {
            const text = await backendResponse.text();
            console.error("Backend Google auth sync failed", {
              status: backendResponse.status,
              body: text,
            });
          }
        } catch (error) {
          console.error("Failed to sync Google user to backend", error);
        }
      }

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

      // If this is an account linking operation, preserve the existing session
      let sessionCookieValue: string;
      const redirectTarget = normalizeRedirectTarget(parsedState.redirect) || "/";

      if (parsedState.linkAccount) {
        // Keep the existing session - don't create a new one
        const existingSessionCookie = cookies[SESSION_COOKIE];
        if (existingSessionCookie) {
          // Verify the existing session email matches the new OAuth email
          const existingSession = await decodeSignedPayload<SessionPayload>(getCookieSecret(env), existingSessionCookie);

          if (existingSession && existingSession.email && primaryEmail) {
            // Check if emails match (case-insensitive)
            if (existingSession.email.toLowerCase() !== primaryEmail.toLowerCase()) {
              // Emails don't match - can't link accounts
              const errorUrl = new URL(redirectTarget, url.origin);
              errorUrl.searchParams.set("error", "email_mismatch");
              errorUrl.searchParams.set("existing_email", existingSession.email);
              errorUrl.searchParams.set("new_email", primaryEmail);

              return new Response(null, {
                status: 303,
                headers: {
                  Location: errorUrl.toString(),
                },
              });
            }
          }

          sessionCookieValue = existingSessionCookie;
        } else {
          // No existing session, create a new one
          const sessionPayload: SessionPayload = {
            login: userData.login,
            id: userData.id,
            name: userData.name ?? null,
            avatarUrl: userData.avatar_url ?? null,
            email: primaryEmail ?? null,
            exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
          };
          sessionCookieValue = await encodeSignedPayload(getCookieSecret(env), sessionPayload);
        }
      } else {
        // Normal login - create a new session
        const sessionPayload: SessionPayload = {
          login: userData.login,
          id: userData.id,
          name: userData.name ?? null,
          avatarUrl: userData.avatar_url ?? null,
          email: primaryEmail ?? null,
          exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        };
        sessionCookieValue = await encodeSignedPayload(getCookieSecret(env), sessionPayload);
      }

      // Best-effort: synchronise the authenticated GitHub user into the backend
      // multi-tenant database. Failures here should not block login.
      if (env.BACKEND_BASE_URL && tokenPayload.access_token) {
        const backendUrl = new URL("/api/auth/github", env.BACKEND_BASE_URL);
        const scope = tokenPayload.scope ?? "";
        const body = JSON.stringify({
          github_id: userData.id,
          login: userData.login,
          name: userData.name ?? null,
          email: primaryEmail ?? null,
          avatar_url: userData.avatar_url ?? null,
          access_token: tokenPayload.access_token,
          scope: scope.length > 0 ? scope : undefined,
        });

        try {
          const backendResponse = await fetch(backendUrl.toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body,
          });
          if (!backendResponse.ok) {
            const text = await backendResponse.text();
            console.error("Backend GitHub auth sync failed", {
              status: backendResponse.status,
              body: text,
            });
          }
        } catch (error) {
          console.error("Failed to sync GitHub user to backend", error);
        }
      }

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
