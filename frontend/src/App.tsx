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

type JiraSettingsFormState = {
  baseUrl: string;
  email: string;
  apiKey: string;
};

const SESSION_ENDPOINT = "/api/auth/session";
const LOGIN_ENDPOINT = "/api/auth/login";
const LOGOUT_ENDPOINT = "/api/auth/logout";

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

function App() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [route, setRoute] = useState<string>(() => window.location.pathname || "/");
  const [isAccountMenuOpen, setAccountMenuOpen] = useState(false);
  const [jiraSettings, setJiraSettings] = useState<JiraSettingsFormState>({
    baseUrl: "",
    email: "",
    apiKey: "",
  });

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

  useEffect(() => {
    const handlePopState = () => {
      setRoute(window.location.pathname || "/");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (session.status === "authenticated" && (route === "/" || route === "")) {
      const target = "/dashboard";
      window.history.replaceState({}, "", target);
      setRoute(target);
    }
  }, [session, route]);

  const navigate = (path: string) => {
    if (path === route) return;
    window.history.pushState({}, "", path);
    setRoute(path);
  };

  const beginLogin = () => {
    const loginUrl = new URL(LOGIN_ENDPOINT, window.location.origin);
    loginUrl.searchParams.set("redirect", "/dashboard");
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
        setAccountMenuOpen(false);
        navigate("/");
      }
    };

    void logout();
  };

  const renderMain = () => {
    if (session.status === "loading") {
      return <p className="app__status">Checking your session…</p>;
    }

    if (session.status === "error") {
      return null;
    }

    if (session.status === "unauthenticated") {
      if (route === "/dashboard" || route === "/settings") {
        return (
          <div className="card card--center">
            <p>You need to sign in with GitHub to access this page.</p>
            <button type="button" className="button button--primary" onClick={beginLogin}>
              Sign in with GitHub
            </button>
          </div>
        );
      }

      return (
        <div className="card card--center">
          <p>Connect your GitHub account to manage your multi-tenant Jira instances.</p>
          <button type="button" className="button button--primary" onClick={beginLogin}>
            Sign in with GitHub
          </button>
        </div>
      );
    }

    if (session.status === "authenticated") {
      if (route === "/settings") {
        return (
          <div className="card">
            <h2 className="app__section-title">Settings</h2>
            <p className="app__status">
              Configure the Jira instance this GitHub user should talk to. These values are stored per account for multi-tenant setups.
            </p>
            <form
              className="settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                const save = async () => {
                  try {
                    const response = await fetch("/api/settings/jira", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        jira_base_url: jiraSettings.baseUrl,
                        jira_email: jiraSettings.email,
                        atlassian_api_key: jiraSettings.apiKey,
                      }),
                    });
                    if (!response.ok) {
                      const text = await response.text();
                      // eslint-disable-next-line no-console
                      console.error("Failed to save Jira settings", response.status, text);
                      return;
                    }
                    // eslint-disable-next-line no-console
                    console.log("Jira settings saved");
                  } catch (error) {
                    // eslint-disable-next-line no-console
                    console.error("Failed to save Jira settings", error);
                  }
                };

                void save();
              }}
            >
              <label className="settings-form__field">
                <span className="settings-form__label">Jira base URL</span>
                <input
                  type="url"
                  required
                  placeholder="https://your-domain.atlassian.net"
                  value={jiraSettings.baseUrl}
                  onChange={(event) => setJiraSettings((prev) => ({ ...prev, baseUrl: event.target.value.trim() }))}
                  className="settings-form__input"
                />
              </label>

              <label className="settings-form__field">
                <span className="settings-form__label">Jira email</span>
                <input
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={jiraSettings.email}
                  onChange={(event) => setJiraSettings((prev) => ({ ...prev, email: event.target.value.trim() }))}
                  className="settings-form__input"
                />
              </label>

              <label className="settings-form__field">
                <span className="settings-form__label">Atlassian API key</span>
                <input
                  type="password"
                  required
                  placeholder="Paste your Atlassian API key"
                  value={jiraSettings.apiKey}
                  onChange={(event) => setJiraSettings((prev) => ({ ...prev, apiKey: event.target.value }))}
                  className="settings-form__input"
                />
              </label>

              <div className="settings-form__actions">
                <button type="submit" className="button button--primary">
                  Save settings
                </button>
              </div>
            </form>
          </div>
        );
      }

      if (route === "/dashboard") {
        return (
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
            <p className="app__status">
              This is your dashboard. As we add multi-tenant Jira features, you&apos;ll see your instances and recent activity here.
            </p>
          </div>
        );
      }

      return (
        <div className="card card--center">
          <p>We couldn&apos;t find that page.</p>
          <button type="button" className="button" onClick={() => navigate("/dashboard")}>
            Go to dashboard
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__header-inner">
          <button type="button" className="app-shell__brand" onClick={() => navigate("/")}>
            <span className="app-shell__logo-dot" />
            <span className="app-shell__brand-text">
              <span className="app-shell__brand-title">MCP Jira Thing</span>
              <span className="app-shell__brand-subtitle">Multi-tenant Jira control plane</span>
            </span>
          </button>

          <nav className="app-shell__nav">
            {session.status === "authenticated" ? (
              <>
                <button
                  type="button"
                  className={`app-shell__nav-item${route === "/dashboard" ? " app-shell__nav-item--active" : ""}`}
                  onClick={() => navigate("/dashboard")}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  className={`app-shell__nav-item${route === "/settings" ? " app-shell__nav-item--active" : ""}`}
                  onClick={() => navigate("/settings")}
                >
                  Settings
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`app-shell__nav-item${route === "/" ? " app-shell__nav-item--active" : ""}`}
                onClick={() => navigate("/")}
              >
                Home
              </button>
            )}
          </nav>

          <div className="app-shell__account">
            {session.status === "loading" && <span className="app-shell__status-pill">Checking session…</span>}
            {session.status === "error" && <span className="app-shell__status-pill app-shell__status-pill--error">Session error</span>}
            {session.status === "unauthenticated" && (
              <button type="button" className="button button--primary app-shell__account-button" onClick={beginLogin}>
                Sign in
              </button>
            )}
            {session.status === "authenticated" && (
              <div className="account-menu">
                <button type="button" className="account-menu__trigger" onClick={() => setAccountMenuOpen((open) => !open)}>
                  {session.user.avatarUrl && (
                    <img
                      className="account-menu__avatar"
                      src={session.user.avatarUrl}
                      alt={`${session.user.login}'s avatar`}
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span className="account-menu__name">{session.user.name ?? session.user.login}</span>
                  <span className="account-menu__chevron">▾</span>
                </button>
                {isAccountMenuOpen && (
                  <div className="account-menu__popover">
                    <button
                      type="button"
                      className="account-menu__item"
                      onClick={() => {
                        navigate("/dashboard");
                        setAccountMenuOpen(false);
                      }}
                    >
                      Dashboard
                    </button>
                    <button
                      type="button"
                      className="account-menu__item"
                      onClick={() => {
                        navigate("/settings");
                        setAccountMenuOpen(false);
                      }}
                    >
                      Settings
                    </button>
                    <button type="button" className="account-menu__item account-menu__item--danger" onClick={beginLogout}>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="app-shell__main">
        {session.status === "error" && <p className="app__status app__status--error">{session.message}</p>}
        {renderMain()}
      </main>

      <footer className="app-shell__footer">
        <div className="app-shell__footer-inner">
          <span>© {new Date().getFullYear()} MCP Jira Thing</span>
          &nbsp;
          <span className="app-shell__footer-meta">Powered by GitHub OAuth and Xata</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
