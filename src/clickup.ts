import { AxiError, mapClickupError, type ClickupHttpError } from "./errors.js";
import { CLICKUP_API_BASE, CLICKUP_API_V3_BASE, resolveToken } from "./config.js";

/**
 * fetch-like seam so tests can inject a fake transport without touching the
 * network. Defaults to the global `fetch`.
 */
export type ClickupFetch = typeof fetch;

let injectedFetch: ClickupFetch | undefined;

/** Inject a fetch implementation (tests). Pass `null` to restore the global. */
export function setFetchImpl(impl: ClickupFetch | null): void {
  injectedFetch = impl ?? undefined;
}

/** Resolve the active fetch implementation (global unless overridden in tests). */
function getFetch(): ClickupFetch {
  return injectedFetch ?? fetch;
}

const MAX_RETRIES = 6; // mirrors the reference example-space-clickup-space clickup_client.py loop
const INITIAL_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;
const REQUEST_TIMEOUT_MS = 30000;

let cachedToken: string | null = null;

/** Resolve and cache the ClickUp API token for the process lifetime. */
export function getToken(): string {
  if (cachedToken) return cachedToken;
  cachedToken = resolveToken();
  return cachedToken;
}

/** Reset the cached token (tests / setup). */
export function resetTokenCache(): void {
  cachedToken = null;
}

export interface RequestOptions {
  method?: string;
  /** Query string params. */
  params?: Record<string, string | number | boolean | undefined>;
  /** JSON body (will be JSON.stringify'd). */
  body?: unknown;
  /** Extra headers. */
  headers?: Record<string, string>;
  /** When true, skip the Authorization header (used by `api` with custom auth). */
  noAuth?: boolean;
  /** API base URL override. Defaults to the v2 base; pass CLICKUP_API_V3_BASE for v3 endpoints. */
  base?: string;
}

export interface ClickupResponse<T = unknown> {
  status: number;
  body: T;
  retryAfter?: number;
}

function buildUrl(path: string, params?: RequestOptions["params"], base?: string): string {
  const apiBase = base ?? CLICKUP_API_BASE;
  const url = path.startsWith("http") ? path : `${apiBase}${path}`;
  if (!params) return url;
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return url;
  const search = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return url.includes("?") ? `${url}&${search}` : `${url}?${search}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Low-level ClickUp API request with 429 backoff.
 *
 * Mirrors the reference `clickup_client.py._request`: up to MAX_RETRIES
 * attempts; on HTTP 429, wait `Retry-After` (or the exponential backoff,
 * capped at 60s), then retry. Non-2xx (after exhausting retries, or for any
 * non-429 error) throws an `AxiError` via `mapClickupError`.
 */
export async function request<T = unknown>(
  options: RequestOptions & { path: string },
): Promise<ClickupResponse<T>> {
  const { method = "GET", path, params, body, headers, noAuth, base } = options;
  const url = buildUrl(path, params, base);
  const init: RequestInit = {
    method,
    headers: {
      ...(noAuth ? {} : { Authorization: getToken() }),
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  };
  if (body !== undefined) {
    // Raw multipart/binary uploads pass a pre-built Buffer/string with an
    // explicit multipart Content-Type; JSON-encode everything else.
    if (Buffer.isBuffer(body) || typeof body === "string") {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
    }
  }

  let delay = INITIAL_BACKOFF_MS;
  const fetchImpl = getFetch();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetchImpl(url, { ...init, signal: ac.signal });
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      throw new AxiError(`ClickUp API request failed: ${message}`, "UNKNOWN", [
        "Check network connectivity and that api.clickup.com is reachable",
      ]);
    }
    clearTimeout(timer);

    const retryAfterHeader = resp.headers.get("Retry-After") ?? resp.headers.get("retry-after");
    const retryAfter = retryAfterHeader ? parseRetryAfter(retryAfterHeader) : undefined;

    if (resp.status === 429) {
      if (attempt === MAX_RETRIES - 1) {
        const httpError: ClickupHttpError = { status: 429, body: undefined, retryAfter };
        throw mapClickupError(httpError);
      }
      const wait = retryAfter !== undefined ? retryAfter * 1000 : delay;
      await sleep(Math.min(wait, MAX_BACKOFF_MS));
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      continue;
    }

    const responseBody = await parseBody(resp);
    if (!resp.ok) {
      throw mapClickupError({ status: resp.status, body: responseBody, retryAfter });
    }
    return { status: resp.status, body: responseBody as T, retryAfter };
  }
  // Exhausted retries without returning — treat as rate-limited.
  throw mapClickupError({ status: 429, body: undefined });
}

async function parseBody(resp: Response): Promise<unknown> {
  const text = await resp.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseRetryAfter(header: string): number | undefined {
  // Retry-After may be seconds (most common) or an HTTP-date.
  const n = Number(header);
  if (!isNaN(n) && n >= 0) return n;
  const date = Date.parse(header);
  if (!isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/** GET a ClickUp API path and return the parsed JSON body. */
export async function get<T = unknown>(
  path: string,
  params?: RequestOptions["params"],
): Promise<T> {
  const resp = await request<T>({ path, method: "GET", params });
  return resp.body;
}

/** POST a JSON body and return the parsed JSON body. */
export async function post<T = unknown>(
  path: string,
  body?: unknown,
  params?: RequestOptions["params"],
): Promise<T> {
  const resp = await request<T>({ path, method: "POST", body, params });
  return resp.body;
}

/** PUT a JSON body and return the parsed JSON body. */
export async function put<T = unknown>(
  path: string,
  body?: unknown,
  params?: RequestOptions["params"],
): Promise<T> {
  const resp = await request<T>({ path, method: "PUT", body, params });
  return resp.body;
}

/** DELETE a ClickUp API path and return the parsed JSON body (or undefined). */
export async function del<T = unknown>(
  path: string,
  params?: RequestOptions["params"],
): Promise<T | undefined> {
  const resp = await request<T>({ path, method: "DELETE", params });
  return resp.body;
}

/**
 * Issue a ClickUp API v3 request. The path is workspace-scoped (e.g.
 * `/workspaces/${teamId}/docs`); the v3 base is applied. Used by the doc and
 * chat command groups (ClickUp has moved Docs and Chat to API v3).
 */
export async function requestV3<T = unknown>(
  options: RequestOptions & { path: string },
): Promise<ClickupResponse<T>> {
  return request<T>({ ...options, base: CLICKUP_API_V3_BASE });
}

/** GET a ClickUp API v3 path and return the parsed JSON body. */
export async function getV3<T = unknown>(
  path: string,
  params?: RequestOptions["params"],
): Promise<T> {
  const resp = await requestV3<T>({ path, method: "GET", params });
  return resp.body;
}

/** POST a JSON body to a ClickUp API v3 path and return the parsed JSON body. */
export async function postV3<T = unknown>(
  path: string,
  body?: unknown,
  params?: RequestOptions["params"],
): Promise<T> {
  const resp = await requestV3<T>({ path, method: "POST", body, params });
  return resp.body;
}

/** PUT a JSON body to a ClickUp API v3 path and return the parsed JSON body. */
export async function putV3<T = unknown>(
  path: string,
  body?: unknown,
  params?: RequestOptions["params"],
): Promise<T> {
  const resp = await requestV3<T>({ path, method: "PUT", body, params });
  return resp.body;
}

/** PATCH a JSON body on a ClickUp API v3 path and return the parsed JSON body. */
export async function patchV3<T = unknown>(
  path: string,
  body?: unknown,
  params?: RequestOptions["params"],
): Promise<T> {
  const resp = await requestV3<T>({ path, method: "PATCH", body, params });
  return resp.body;
}

/** DELETE a ClickUp API v3 path and return the parsed JSON body (or undefined). */
export async function delV3<T = unknown>(
  path: string,
  params?: RequestOptions["params"],
): Promise<T | undefined> {
  const resp = await requestV3<T>({ path, method: "DELETE", params });
  return resp.body;
}
