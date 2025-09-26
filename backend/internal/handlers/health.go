package handlers

import (
	"encoding/json"
	"net/http"
	"time"
)

// Health responds with status 200 to indicate the service is running.
func Health(w http.ResponseWriter, r *http.Request) {
	payload := map[string]any{
		"status":    "ok",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}
