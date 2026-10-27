import type { Task, TaskFilters, TaskInput } from "./types";

const BASE = `${import.meta.env.VITE_API_URL ?? ""}/api/v1/tasks`;

export class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the backend. Is it running?");
  }
  if (!res.ok) {
    throw new ApiError(await errorMessage(res));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// FastAPI returns {detail: string} or {detail: [{loc, msg}, ...]} for validation errors.
async function errorMessage(res: Response): Promise<string> {
  try {
    const { detail } = await res.json();
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => `${d.loc?.at(-1) ?? "field"}: ${d.msg}`).join("; ");
    }
  } catch {
    // fall through
  }
  return `Request failed (${res.status})`;
}

export function listTasks(filters: TaskFilters): Promise<Task[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  return request(`${BASE}?${params}`);
}

export function createTask(data: TaskInput): Promise<Task> {
  return request(BASE, { method: "POST", body: JSON.stringify(data) });
}

export function updateTask(id: number, data: Partial<TaskInput>): Promise<Task> {
  return request(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteTask(id: number): Promise<void> {
  return request(`${BASE}/${id}`, { method: "DELETE" });
}
