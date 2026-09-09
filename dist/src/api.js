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
    csrfToken;
    webDid;
    timeoutMs;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.sessionToken = options.sessionToken || "";
        this.csrfToken = options.csrfToken || "";
        this.webDid = options.webDid || "";
        this.timeoutMs = options.timeoutMs ?? 60_000;
    }
    async request(method, path, data, options = {}) {
        const url = this.url(path);
        let body;
        if (data !== undefined) {
            body = JSON.stringify(data);
        }
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const headers = this.requestHeaders(body !== undefined);
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
            this.captureCookies(response.headers);
            if (response.ok) {
                if (options.expectBytes) {
                    return { bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
                }
                return (await decodeResponse(response));
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
    async login(username, password) {
        await this.bootstrapCsrf(false);
        return this.request("POST", "/api/auth/login", { username, password });
    }
    async register(username, password) {
        await this.bootstrapCsrf(false);
        return this.request("POST", "/api/auth/register", { username, password });
    }
    url(path) {
        if (/^https?:\/\//i.test(path)) {
            return path;
        }
        return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
    }
    requestHeaders(hasJsonBody) {
        const headers = { accept: "application/json" };
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
    async bootstrapCsrf(required) {
        const url = this.url("/login");
        let response;
        try {
            response = await fetch(url, {
                headers: { accept: "text/html" },
                redirect: "manual",
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        }
        catch (error) {
            if (!required)
                return;
            const message = error instanceof Error ? error.message : String(error);
            throw new ApiError(0, { error: `cannot initialize CSRF protection: ${message}` }, url);
        }
        if (!response.ok) {
            if (!required)
                return;
            throw new ApiError(response.status, { error: "cannot initialize CSRF protection" }, url);
        }
        this.captureCookies(response.headers);
        if (!this.csrfToken && required) {
            throw new ApiError(response.status, { error: "application did not return a CSRF token" }, url);
        }
    }
    captureCookies(headers) {
        const headerList = [];
        const getSetCookie = headers.getSetCookie;
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
function cookieValue(headers, name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const header of headers) {
        const match = new RegExp(`(?:^|[,;]\\s*)${escapedName}=([^;,\\s]+)`, "u").exec(header);
        if (match?.[1])
            return match[1];
    }
    return "";
}
function isCsrfFailure(status, data) {
    return status === 403 && serverError(data).toLowerCase().includes("csrf");
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
