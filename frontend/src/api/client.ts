import { apiUrl } from "../config";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const expireSession = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.dispatchEvent(new Event("mediflow:unauthorized"));
};

export async function apiRequest<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (authenticated) {
    const token = localStorage.getItem("token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(apiUrl(path), { ...options, headers });
  if (response.status === 401 && authenticated) expireSession();
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  if (response.status === 403 && authenticated && /account is disabled/i.test(data?.message || "")) expireSession();
  if (!response.ok) throw new ApiError(data?.message || "Request failed", response.status);
  return data as T;
}

export async function apiDownload(path: string): Promise<Blob> {
  const token = localStorage.getItem("token");
  const response = await fetch(apiUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (response.status === 401) expireSession();
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.message || "Unable to open file", response.status);
  }
  return response.blob();
}
