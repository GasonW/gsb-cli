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
  readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.sessionToken = options.sessionToken || "";
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
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (data !== undefined) {
      body = JSON.stringify(data);
      headers["content-type"] = "application/json";
    }
    if (this.sessionToken) {
      headers.cookie = `session_token=${this.sessionToken}`;
    }

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

    this.captureCookie(response.headers);
    if (!response.ok) {
      throw new ApiError(response.status, await decodeResponse(response), url);
    }

    if (options.expectBytes) {
      return { bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
    }
    return (await decodeResponse(response)) as T;
  }

  async login(username: string, password: string): Promise<JsonObject> {
    return this.request<JsonObject>("POST", "/api/auth/login", { username, password });
  }

  private url(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
  }

  private captureCookie(headers: Headers): void {
    const headerList: string[] = [];
    const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === "function") {
      headerList.push(...getSetCookie.call(headers));
    }
    const single = headers.get("set-cookie");
    if (single) {
      headerList.push(single);
    }
    for (const header of headerList) {
      const match = /(?:^|;\s*)session_token=([^;]+)/.exec(header);
      if (match?.[1]) {
        this.sessionToken = match[1];
      }
    }
  }
}

export function serverError(data: unknown): string {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    return String(obj.error || obj.raw || JSON.stringify(obj));
  }
  return String(data);
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
