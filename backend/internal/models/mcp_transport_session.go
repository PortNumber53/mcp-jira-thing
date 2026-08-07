package models

import (
	"encoding/json"
	"time"
)

const (
	MCPTransportSSE            = "sse"
	MCPTransportStreamableHTTP = "streamable_http"
)

// MCPTransportSession is the durable, serializable portion of an MCP
// transport session. Live HTTP response streams remain owned by the Node.js
// process, while this record is the source of truth for session identity and
// reconstruction after a process restart.
type MCPTransportSession struct {
	SessionID   string          `json:"session_id"`
	Transport   string          `json:"transport"`
	UserID      *int64          `json:"-"`
	UserLogin   *string         `json:"user_login,omitempty"`
	UserEmail   *string         `json:"user_email,omitempty"`
	UserName    *string         `json:"user_name,omitempty"`
	MCPSecret   *string         `json:"-"`
	InitRequest json.RawMessage `json:"init_request"`
	ExpiresAt   time.Time       `json:"expires_at"`
	LastSeenAt  time.Time       `json:"last_seen_at"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}
