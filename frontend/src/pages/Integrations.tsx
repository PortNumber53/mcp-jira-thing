import { useEffect, useState } from "react";

type IntegrationTokenPublic = {
  provider: string;
  token_type: string;
  expires_at?: string | null;
  scopes?: string | null;
  connected: boolean;
  created_at: string;
  updated_at: string;
};

type IntegrationDef = {
  id: string;
  name: string;
  description: string;
  connectUrl?: string;
  icon: string;
};

const KNOWN_INTEGRATIONS: IntegrationDef[] = [
  {
    id: "google_docs",
    name: "Google Docs",
    description: "Read and modify Google Docs through the MCP agent. Enables document search, text extraction, and content editing.",
    connectUrl: "/api/integrations/google-docs/connect",
    icon: "📄",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages, list channels, and post task notifications to Slack from the MCP agent.",
    icon: "💬",
  },
];

const Integrations = () => {
  const [tokens, setTokens] = useState<IntegrationTokenPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const err = params.get("error");

    if (connected) {
      const integration = KNOWN_INTEGRATIONS.find((i) => i.id === connected);
      setSuccessMessage(`${integration?.name ?? connected} connected successfully!`);
      window.history.replaceState({}, "", "/integrations");
    }
    if (err) {
      setError(`Connection failed: ${err}`);
      window.history.replaceState({}, "", "/integrations");
    }
  }, []);

  useEffect(() => {
    const loadTokens = async () => {
      try {
        const resp = await fetch("/api/integrations/tokens", { method: "GET", credentials: "include" });
        if (resp.ok) {
          const data = (await resp.json()) as { integrations: IntegrationTokenPublic[] };
          setTokens(data.integrations || []);
        }
      } catch (err) {
        console.error("Failed to load integrations", err);
      } finally {
        setLoading(false);
      }
    };
    void loadTokens();
  }, []);

  const handleDisconnect = async (provider: string) => {
    setDisconnecting(provider);
    try {
      const resp = await fetch(`/api/integrations/tokens?provider=${encodeURIComponent(provider)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (resp.ok) {
        setTokens((prev) => prev.filter((t) => t.provider !== provider));
        setSuccessMessage(`${KNOWN_INTEGRATIONS.find((i) => i.id === provider)?.name ?? provider} disconnected.`);
      } else {
        setError("Failed to disconnect integration.");
      }
    } catch {
      setError("Failed to disconnect integration.");
    } finally {
      setDisconnecting(null);
    }
  };

  const handleConnect = (integration: IntegrationDef) => {
    if (integration.connectUrl) {
      window.location.href = integration.connectUrl;
    }
  };

  if (loading) {
    return (
      <div className="card">
        <h2 className="app__section-title">Integrations</h2>
        <p className="app__status">Loading integrations…</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="app__section-title">Integrations</h2>
      <p className="app__status">
        Connect third-party services to extend what the MCP agent can do. Connected integrations
        are available as tools in your MCP client.
      </p>

      {successMessage && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            borderRadius: "8px",
            backgroundColor: "rgba(34, 197, 94, 0.15)",
            border: "1px solid rgba(34, 197, 94, 0.4)",
            color: "#86efac",
          }}
        >
          {successMessage}
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            style={{
              float: "right",
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            borderRadius: "8px",
            backgroundColor: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            color: "#fca5a5",
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              float: "right",
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: "grid", gap: "1rem" }}>
        {KNOWN_INTEGRATIONS.map((integration) => {
          const token = tokens.find((t) => t.provider === integration.id);
          const isConnected = !!token;

          return (
            <div
              key={integration.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1.25rem",
                borderRadius: "12px",
                border: isConnected
                  ? "1px solid rgba(34, 197, 94, 0.3)"
                  : "1px solid rgba(255, 255, 255, 0.1)",
                backgroundColor: isConnected
                  ? "rgba(34, 197, 94, 0.05)"
                  : "rgba(255, 255, 255, 0.02)",
                transition: "border-color 0.2s, background-color 0.2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", flex: 1 }}>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.5rem",
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    flexShrink: 0,
                  }}
                >
                  {integration.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <strong style={{ fontSize: "1.05rem" }}>{integration.name}</strong>
                    {isConnected && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.15rem 0.5rem",
                          borderRadius: "9999px",
                          backgroundColor: "rgba(34, 197, 94, 0.2)",
                          color: "#86efac",
                          fontWeight: 600,
                        }}
                      >
                        Connected
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      margin: "0.25rem 0 0",
                      fontSize: "0.875rem",
                      color: "var(--app-muted-color, #94a3b8)",
                      lineHeight: 1.4,
                    }}
                  >
                    {integration.description}
                  </p>
                  {isConnected && token.scopes && (
                    <p
                      style={{
                        margin: "0.35rem 0 0",
                        fontSize: "0.75rem",
                        color: "var(--app-muted-color, #64748b)",
                      }}
                    >
                      Scopes: {token.scopes}
                    </p>
                  )}
                  {isConnected && token.expires_at && (
                    <p
                      style={{
                        margin: "0.15rem 0 0",
                        fontSize: "0.75rem",
                        color: "var(--app-muted-color, #64748b)",
                      }}
                    >
                      Token expires: {new Date(token.expires_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0, marginLeft: "1rem" }}>
                {isConnected ? (
                  <button
                    type="button"
                    className="button"
                    disabled={disconnecting === integration.id}
                    onClick={() => void handleDisconnect(integration.id)}
                    style={{
                      borderColor: "rgba(239, 68, 68, 0.4)",
                      color: "#fca5a5",
                    }}
                  >
                    {disconnecting === integration.id ? "Disconnecting…" : "Disconnect"}
                  </button>
                ) : integration.connectUrl ? (
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => handleConnect(integration)}
                  >
                    Connect
                  </button>
                ) : (
                  <button type="button" className="button" disabled title="Coming soon">
                    Coming soon
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="settings-form settings-form--secondary" style={{ marginTop: "2rem" }}>
        <h3 className="app__section-title">How it works</h3>
        <ol className="app__status" style={{ paddingLeft: "1.25rem", margin: 0, lineHeight: 1.8 }}>
          <li>Click <strong>Connect</strong> on an integration above to authorize access.</li>
          <li>You will be redirected to the provider&apos;s OAuth consent screen.</li>
          <li>After granting access, your token is securely stored and the integration becomes available as MCP tools.</li>
          <li>The MCP agent can then use the integration (e.g. read/edit Google Docs, send Slack messages) on your behalf.</li>
          <li>Click <strong>Disconnect</strong> at any time to revoke access.</li>
        </ol>
      </div>
    </div>
  );
};

export default Integrations;
