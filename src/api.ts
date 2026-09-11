import type { ApiClientOptions, JsonObject } from "./types.js";

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly url: string;

  constructor(status: number, data: unknown, url: string) {
    super(`HTTP ${status}: ${JSON.stringify(data)}`);
    this.status = status;
    this.data = data;
    this.url = url;
  }
}

export class ApiClient {
  readonly baseUrl: string;
  sessionToken: string;
  csrfToken: string;
  webDid: string;
  readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.sessionToken = options.sessionToken || "";
    this.csrfToken = options.csrfToken || "";
    this.webDid = options.webDid || "";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    data?: unknown,
    options?: { expectBytes?: false },
  ): Promise<T>;
  async request(
    method: string,
    path: string,
    data: unknown,
    options: { expectBytes: true },
  ): Promise<{ bytes: Buffer; headers: Headers }>;
  async request<T = unknown>(
    method: string,
    path: string,
    data?: unknown,
    options: { expectBytes?: boolean } = {},
  ): Promise<T | { bytes: Buffer; headers: Headers }> {
    const url = this.url(path);
    let body: string | undefined;
    if (data !== undefined) {
      body = JSON.stringify(data);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const headers = this.requestHeaders(body !== undefined);
      let response: Response;
      try {
        response = await fetch(url, {
          method: method.toUpperCase(),
          headers,
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ApiError(0, { error: message }, url);
      }

      this.captureCookies(response.headers);
      if (response.ok) {
        if (options.expectBytes) {
          return { bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
        }
        return (await decodeResponse(response)) as T;
      }

      const decoded = await decodeResponse(response);
      if (attempt === 0 && isCsrfFailure(response.status, decoded)) {
        await this.bootstrapCsrf(true);
        continue;
      }
      throw new ApiError(response.status, decoded, url);
    }

    throw new ApiError(0, { error: "request retry exhausted" }, url);
  }

  async login(username: string, password: string): Promise<JsonObject> {
    await this.bootstrapCsrf(false);
    return this.request<JsonObject>("POST", "/api/auth/login", { username, password });
  }

  async register(username: string, password: string): Promise<JsonObject> {
    await this.bootstrapCsrf(false);
    return this.request<JsonObject>("POST", "/api/auth/register", { username, password });
  }

  private url(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
  }

  private requestHeaders(hasJsonBody: boolean): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (hasJsonBody) {
      headers["content-type"] = "application/json";
    }
    if (this.csrfToken) {
      headers["x-suda-csrf-token"] = this.csrfToken;
    }
    const cookies = [
      ...(this.csrfToken ? [`suda-csrf-token=${this.csrfToken}`] : []),
      ...(this.webDid ? [`suda_web_did=${this.webDid}`] : []),
      ...(this.sessionToken ? [`session_token=${this.sessionToken}`] : []),
    ];
    if (cookies.length) {
      headers.cookie = cookies.join("; ");
    }
    return headers;
  }

  private async bootstrapCsrf(required: boolean): Promise<void> {
    const url = this.url("/login");
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (!required) return;
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(0, { error: `cannot initialize CSRF protection: ${message}` }, url);
    }
    if (!response.ok) {
      if (!required) return;
      throw new ApiError(response.status, { error: "cannot initialize CSRF protection" }, url);
    }
    this.captureCookies(response.headers);
    if (!this.csrfToken && required) {
      throw new ApiError(response.status, { error: "application did not return a CSRF token" }, url);
    }
  }

  private captureCookies(headers: Headers): void {
    const headerList: string[] = [];
    const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === "function") {
      headerList.push(...getSetCookie.call(headers));
    }
    const single = headers.get("set-cookie");
    if (single) {
      headerList.push(single);
    }
    this.sessionToken = cookieValue(headerList, "session_token") || this.sessionToken;
    this.csrfToken = cookieValue(headerList, "suda-csrf-token") || this.csrfToken;
    this.webDid = cookieValue(headerList, "suda_web_did") || this.webDid;
  }
}

function cookieValue(headers: string[], name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const header of headers) {
    const match = new RegExp(`(?:^|[,;]\\s*)${escapedName}=([^;,\\s]+)`, "u").exec(header);
    if (match?.[1]) return match[1];
  }
  return "";
}

function isCsrfFailure(status: number, data: unknown): boolean {
  return status === 403 && serverError(data).toLowerCase().includes("csrf");
}

export function serverError(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "请求失败";
  const obj = data as Record<string, unknown>;
  const error = obj.error ?? obj;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const detail = error as Record<string, unknown>;
    const message = typeof detail.message === "string" ? detail.message
      : Array.isArray(detail.message) ? detail.message.filter((item) => typeof item === "string").join("；") : "";
    const code = typeof detail.code === "string" ? detail.code : "";
    if (message || code) return `${message || "请求失败"}${code ? ` (${code})` : ""}`;
  }
  return typeof obj.raw === "string" ? obj.raw : "请求失败";
}

async function decodeResponse(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return {};
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json") || /^[\s\r\n]*[\[{]/.test(raw)) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return { raw };
    }
  }
  return { raw };
}
