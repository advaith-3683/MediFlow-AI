export function resolveApiBase(value: string | undefined, production: boolean): string {
  const configured = value?.trim();
  if (configured === "/") return ""; // Explicit same-origin reverse-proxy deployment.
  if (!configured && !production) return "http://localhost:5000";
  try {
    if (!configured) throw new Error();
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
        (production && (url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw new Error("Set VITE_API_URL to the backend HTTPS origin, or / for an explicitly configured same-origin API proxy."); }
}
