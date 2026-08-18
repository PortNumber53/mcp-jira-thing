// Backend API origin. In production, this is the Go backend's public URL.
// In local dev with Vite proxy, this is empty (Vite proxies /api/* to the backend).
const API_BASE = import.meta.env.VITE_BACKEND_ORIGIN || "";

export function apiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return API_BASE + path;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include",
  });
}

export function apiOrigin(): string {
  return API_BASE;
}
