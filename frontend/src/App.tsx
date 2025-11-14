import { useEffect, useState } from "react";
import "./App.css";
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import Billing from './pages/Billing';

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

type JiraSettingsRecord = {
  jira_base_url: string;
  jira_email: string;
  jira_cloud_id?: string | null;
  is_default?: boolean;
};

type JiraSettingsResponse = {
  settings?: JiraSettingsRecord[];
};

type MCPSecretResponse = {
  mcp_secret?: string | null;
};

type ConnectedAccount = {
  provider: string;
  provider_account_id: string;
  avatar_url?: string | null;
  connected_at: string;
};

type ConnectedAccountsResponse = {
  connected_accounts: ConnectedAccount[];
};

const SESSION_ENDPOINT = "/api/auth/session";
const LOGIN_ENDPOINT = "/api/auth/login";
const LOGOUT_ENDPOINT = "/api/auth/logout";
const GOOGLE_LOGIN_ENDPOINT = "/api/auth/google/login";

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

const AppContent = () => {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const location = useLocation();
  const navigate = useNavigate();
  const route = location.pathname;
  const [isAccountMenuOpen, setAccountMenuOpen] = useState(false);
  const [jiraSettings, setJiraSettings] = useState<JiraSettingsFormState>({
    baseUrl: "",
    email: "",
    apiKey: "",
  });
  const [mcpSecret, setMcpSecret] = useState<string | null>(null);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);

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
    if (session.status !== "authenticated" || route !== "/settings") {
      return;
    }

    const loadSettings = async () => {
      try {
        const [settingsResp, secretResp, connectedAccountsResp] = await Promise.all([
          fetch("/api/settings/jira", { method: "GET" }),
          fetch("/api/mcp/secret", { method: "GET" }),
          fetch("/api/auth/connected-accounts", { method: "GET" }),
        ]);

        if (settingsResp.ok) {
          const data: JiraSettingsResponse = (await settingsResp.json()) as JiraSettingsResponse;
          const records = data.settings ?? [];
          const primary = records.find((item) => item.is_default) ?? records[0];
          if (primary) {
            setJiraSettings((prev) => ({
              baseUrl: primary.jira_base_url,
              email: primary.jira_email,
              apiKey: prev.apiKey,
            }));
          }
        }

        if (secretResp.ok) {
          const data: MCPSecretResponse = (await secretResp.json()) as MCPSecretResponse;
          setMcpSecret(data.mcp_secret ?? null);
        }

        if (connectedAccountsResp.ok) {
          const data: ConnectedAccountsResponse = (await connectedAccountsResp.json()) as ConnectedAccountsResponse;
          setConnectedAccounts(data.connected_accounts || []);
        }
      } catch (error) {
        console.error("Failed to load settings", error);
      }
    };

    void loadSettings();
  }, [session, route]);

  useEffect(() => {
    if (session.status === "authenticated" && (route === "/" || route === "")) {
      navigate("/dashboard", { replace: true });
    }
  }, [session, route, navigate]);

  const beginLoginWithGitHub = () => {
    const loginUrl = new URL(LOGIN_ENDPOINT, window.location.origin);
    loginUrl.searchParams.set("redirect", "/dashboard");
    window.location.href = loginUrl.toString();
  };

  const beginLoginWithGoogle = () => {
    const loginUrl = new URL("/api/auth/google/login", window.location.origin);
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
      if (route === "/dashboard" || route === "/settings" || route === "/billing") {
        return (
          <div className="card card--center">
            <p>You need to sign in to access this page.</p>
            <div className="login-buttons">
              <button type="button" className="button button--primary" onClick={beginLoginWithGitHub}>
                Sign in with GitHub
              </button>
              <button type="button" className="button" onClick={beginLoginWithGoogle}>
                Sign in with Google
              </button>
            </div>
            <p style={{ fontSize: '0.875rem', color: '#666', marginTop: '1rem', maxWidth: '400px' }}>
              Note: To switch GitHub accounts, please log out of GitHub.com first. Google login allows account selection.
            </p>
          </div>
        );
      }

      return (
        <div className="card card--center">
          <p>Connect your account to manage your multi-tenant Jira instances.</p>
          <div className="login-buttons">
            <button type="button" className="button button--primary" onClick={beginLoginWithGitHub}>
              Sign in with GitHub
            </button>
            <button type="button" className="button" onClick={beginLoginWithGoogle}>
              Sign in with Google
            </button>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#666', marginTop: '1rem', maxWidth: '400px' }}>
            Note: To switch GitHub accounts, please log out of GitHub.com first. Google login allows account selection.
          </p>
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
                      console.error("Failed to save Jira settings", response.status, text);
                      return;
                    }
                    console.log("Jira settings saved");
                  } catch (error) {
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

            <div className="settings-form settings-form--secondary">
              <h3 className="app__section-title">Tenant MCP Secret</h3>
              <p className="app__status">
                Use this secret in your MCP client configuration to identify your tenant when
                connecting to this Jira server.
              </p>
              <div className="settings-form__field">
                <span className="settings-form__label">MCP secret</span>
                <input
                  type="text"
                  readOnly
                  className="settings-form__input"
                  value={mcpSecret ?? "Not generated yet"}
                />
              </div>
              <div className="settings-form__actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    const rotate = async () => {
                      try {
                        const response = await fetch("/api/mcp/secret", { method: "POST" });
                        if (!response.ok) {
                          const text = await response.text();
                          console.error("Failed to rotate MCP secret", response.status, text);
                          return;
                        }
                        const data: MCPSecretResponse = (await response.json()) as MCPSecretResponse;
                        setMcpSecret(data.mcp_secret ?? null);
                      } catch (error) {
                        console.error("Failed to rotate MCP secret", error);
                      }
                    };

                    void rotate();
                  }}
                >
                  {mcpSecret ? "Rotate secret" : "Generate secret"}
                </button>
              </div>
            </div>

            <div className="settings-form settings-form--secondary">
              <h3 className="app__section-title">Connected Accounts</h3>
              <p className="app__status">
                Link multiple OAuth providers to your account. You can sign in with any connected provider.
              </p>
              <div className="connected-accounts">
                {['github', 'google'].map((provider) => {
                  const connected = connectedAccounts.find((acc) => acc.provider === provider);
                  const isConnected = !!connected;

                  return (
                    <div
                      key={provider}
                      className={`connected-account-card ${isConnected ? 'connected-account-card--connected' : ''}`}
                    >
                      <div className="connected-account-info">
                        <div className={`connected-account-avatar connected-account-avatar--${provider}`}>
                          {provider[0].toUpperCase()}
                        </div>
                        <div className="connected-account-details">
                          <div className="connected-account-name">
                            {provider}
                          </div>
                          {isConnected && connected && (
                            <div className="connected-account-date">
                              Connected {new Date(connected.connected_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`button connected-account-button ${isConnected ? '' : 'button--primary'}`}
                        disabled={isConnected}
                        onClick={() => {
                          console.log('Connect button clicked for provider:', provider);
                          const endpoint = provider === 'github' ? LOGIN_ENDPOINT : GOOGLE_LOGIN_ENDPOINT;
                          console.log('Using endpoint:', endpoint);
                          const loginUrl = new URL(endpoint, window.location.origin);
                          loginUrl.searchParams.set("redirect", "/settings");
                          console.log('Navigating to:', loginUrl.toString());
                          window.location.href = loginUrl.toString();
                        }}
                      >
                        {isConnected ? 'Connected' : 'Connect'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
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

      if (route === "/billing") {
        return (
          <Billing />
        );
      }

      return (
        <div className="card card--center">
          <p>We couldn&apos;t find that page.</p>
          <Link to="/dashboard" className="button">
            Go to dashboard
          </Link>
        </div>
      );
    }

    return null;
  };

    return (
      <div className="app-shell">
        <header className="app-shell__header">
          <div className="app-shell__header-inner">
            <Link to="/" className="app-shell__brand">
              <span className="app-shell__logo-dot" />
              <span className="app-shell__brand-text">
                <span className="app-shell__brand-title">MCP Jira Thing</span>
                <span className="app-shell__brand-subtitle">Multi-tenant Jira control plane</span>
              </span>
            </Link>

            <nav className="app-shell__nav">
              {session.status === "authenticated" ? (
                <>
                  <Link to="/dashboard" className={`app-shell__nav-item${location.pathname === "/dashboard" ? " app-shell__nav-item--active" : ""}`}>
                    Dashboard
                  </Link>
                                    <Link to="/settings" className={`app-shell__nav-item${location.pathname === "/settings" ? " app-shell__nav-item--active" : ""}`}>
                    Settings
                  </Link>
                                    <Link to="/billing" className={`app-shell__nav-item${location.pathname === "/billing" ? " app-shell__nav-item--active" : ""}`}>
                    Billing
                  </Link>
                </>
              ) : (
                <Link to="/" className={`app-shell__nav-item${route === "/" ? " app-shell__nav-item--active" : ""}`}>
                  Home
                </Link>
              )}
            </nav>

            <div className="app-shell__account">
              {session.status === "loading" && <span className="app-shell__status-pill">Checking session…</span>}
              {session.status === "error" && <span className="app-shell__status-pill app-shell__status-pill--error">Session error</span>}
              {session.status === "unauthenticated" && (
                <div className="login-buttons">
                  <button type="button" className="button button--primary app-shell__account-button" onClick={beginLoginWithGitHub}>
                    GitHub
                  </button>
                  <button type="button" className="button app-shell__account-button" onClick={beginLoginWithGoogle}>
                    Google
                  </button>
                </div>
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
                      <button
                        type="button"
                        className="account-menu__item"
                        onClick={() => {
                          navigate("/billing");
                          setAccountMenuOpen(false);
                        }}
                      >
                        Billing
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
          <div className="app-shell__content">
            {session.status === "error" && <p className="app__status app__status--error">{session.message}</p>}
            <Routes>
              <Route path="/billing" element={<Billing />} />
              <Route path="*" element={renderMain()} />
            </Routes>
          </div>
        </main>

        <footer className="app-shell__footer">
          <div className="app-shell__footer-inner">
            <span> 2023 MCP Jira Thing</span>
            &nbsp;
            <span className="app-shell__footer-meta">Powered by GitHub OAuth and Xata</span>
          </div>
        </footer>
      </div>
  );
}

const App = () => (
  <Router>
    <AppContent />
  </Router>
);

export default App;
