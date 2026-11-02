// Typed client for the Worker API. Money fields ending in Cents are integer paise.

export class ApiError extends Error {
  status: number;
  code?: string;
  // The whole error body (e.g. groupId/groupName for "group_locked").
  data: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new ApiError("Network problem. Check your connection and try again.", 0);
  }
  let data: unknown = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError((data as { error?: string }).error || "Something went wrong. Please try again.", res.status, (data as { code?: string }).code, data as Record<string, unknown>);
  return data as T;
}
export const get = <T,>(path: string) => request<T>(path);
export const post = <T = { ok: true },>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });


// The API's answers (shared with the Worker).
export type * from "../../../shared/api-types";
