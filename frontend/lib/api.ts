import type { BackendConfig, CameraInfo, StatusMessage } from "./types";

export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const WS_URL = BACKEND_URL.replace(/^http/, "ws") + "/ws";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BACKEND_URL + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getConfig: () => request<BackendConfig>("/config"),
  updateConfig: (patch: Partial<Pick<BackendConfig, "confidence" | "imgsz" | "source">>) =>
    request<BackendConfig>("/config", { method: "POST", body: JSON.stringify(patch) }),
  control: (action: "pause" | "resume" | "reset_stats") =>
    request<StatusMessage>("/control", { method: "POST", body: JSON.stringify({ action }) }),
  cameras: () => request<{ cameras: CameraInfo[]; current_source: number | string }>("/cameras"),
};
