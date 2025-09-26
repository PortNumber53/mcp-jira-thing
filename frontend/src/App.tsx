import { useEffect, useState } from "react";
import "./App.css";

type SessionUser = {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

type SessionState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: SessionUser }
  | { status: "error"; message: string };

type SessionResponse = {
  authenticated: boolean;
  user?: SessionUser;
};

const isSessionResponse = (value: unknown): value is SessionResponse => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.authenticated !== "boolean") {
    return false;
  }
  if (record.user === undefined) {
    return true;
  }
  if (typeof record.user !== "object" || record.user === null) {
    return false;
  }
  const user = record.user as Record<string, unknown>;
  return typeof user.id === "number" && typeof user.login === "string";
};

const SESSION_ENDPOINT = "/api/auth/session";
const LOGIN_ENDPOINT = "/api/auth/login";
const LOGOUT_ENDPOINT = "/api/auth/logout";

function App() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const loadSession = async () => {
      try {
        const response = await fetch(SESSION_ENDPOINT, { credentials: "include", signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const data: unknown = await response.json();

        if (signal.aborted) {
          return;
        }

        if (!isSessionResponse(data)) {
          throw new Error("Unexpected session payload");
        }

        if (data.authenticated && data.user) {
          setSession({ status: "authenticated", user: data.user });
        } else {
          setSession({ status: "unauthenticated" });
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        console.error("Failed to fetch session", error);
        if (!signal.aborted) {
          setSession({ status: "error", message: "Unable to verify your session. Please try again." });
        }
      }
    };

    void loadSession();

    return () => {
      controller.abort();
    };
  }, []);

  const beginLogin = () => {
    const currentPath = `${window.location.pathname}${window.location.search}`;
    const isSensitiveRoute = window.location.pathname.startsWith("/api/auth") || window.location.pathname.startsWith("/callback");
    const redirectTarget = isSensitiveRoute ? "/" : currentPath;
    const loginUrl = new URL(LOGIN_ENDPOINT, window.location.origin);
    loginUrl.searchParams.set("redirect", redirectTarget);
    window.location.href = loginUrl.toString();
  };

  const beginLogout = () => {
    const logout = async () => {
      try {
        await fetch(LOGOUT_ENDPOINT, {
          method: "POST",
          credentials: "include",
        });
      } catch (error) {
        console.error("Failed to sign out", error);
      } finally {
        setSession({ status: "unauthenticated" });
      }
    };

    void logout();
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">MCP Jira Thing</h1>
        <p className="app__subtitle">Sign in with GitHub to access the dashboard and manage asynchronous tasks.</p>
      </header>

      <main className="app__content">
        {session.status === "loading" && <p className="app__status">Checking your session…</p>}

        {session.status === "error" && <p className="app__status app__status--error">{session.message}</p>}

        {session.status === "unauthenticated" && (
          <div className="card card--center">
            <p>Connect your GitHub account to continue.</p>
            <button type="button" className="button button--primary" onClick={beginLogin}>
              Sign in with GitHub
            </button>
          </div>
        )}

        {session.status === "authenticated" && (
          <div className="card">
            <div className="user-summary">
              {session.user.avatarUrl && (
                <img
                  className="user-summary__avatar"
                  src={session.user.avatarUrl}
                  alt={`${session.user.login}'s avatar`}
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="user-summary__details">
                <p className="user-summary__name">{session.user.name ?? session.user.login}</p>
                <p className="user-summary__meta">
                  @{session.user.login}
                  {session.user.email ? ` • ${session.user.email}` : ""}
                </p>
              </div>
            </div>
            <button type="button" className="button" onClick={beginLogout}>
              Sign out
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
