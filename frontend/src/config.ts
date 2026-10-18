import { resolveApiBase } from "./api/deploymentConfig";
export const API_BASE_URL = resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD);

export const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

