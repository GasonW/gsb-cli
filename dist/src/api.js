export class ApiError extends Error {
    status;
    data;
    url;
    constructor(status, data, url) {
        super(`HTTP ${status}: ${JSON.stringify(data)}`);
        this.status = status;
        this.data = data;
        this.url = url;
    }
}
export class ApiClient {
    baseUrl;
    sessionToken;
    timeoutMs;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.sessionToken = options.sessionToken || "";
        this.timeoutMs = options.timeoutMs ?? 60_000;
    }
    async request(method, path, data, options = {}) {
        const url = this.url(path);
        const headers = {};
        let body;
        if (data !== undefined) {
            body = JSON.stringify(data);
            headers["content-type"] = "application/json";
        }
        if (this.sessionToken) {
            headers.cookie = `session_token=${this.sessionToken}`;
        }
        let response;
        try {
            response = await fetch(url, {
                method: method.toUpperCase(),
                headers,
                body,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        }
        catch (error) {
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
        return (await decodeResponse(response));
    }
    async login(username, password) {
        return this.request("POST", "/api/auth/login", { username, password });
    }
    url(path) {
        if (/^https?:\/\//i.test(path)) {
            return path;
        }
        return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
    }
    captureCookie(headers) {
        const headerList = [];
        const getSetCookie = headers.getSetCookie;
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
export function serverError(data) {
    if (data && typeof data === "object") {
        const obj = data;
        return String(obj.error || obj.raw || JSON.stringify(obj));
    }
    return String(data);
}
async function decodeResponse(response) {
    const raw = await response.text();
    if (!raw) {
        return {};
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json") || /^[\s\r\n]*[\[{]/.test(raw)) {
        try {
            return JSON.parse(raw);
        }
        catch {
            return { raw };
        }
    }
    return { raw };
}
