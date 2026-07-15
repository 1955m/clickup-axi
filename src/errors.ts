import { AxiError, exitCodeForError } from "axi-sdk-js";

export { AxiError, exitCodeForError };

export interface ClickupHttpError {
  status: number;
  body: unknown;
  /** Retry-After header value (seconds) when present. */
  retryAfter?: number;
}

interface ErrorPattern {
  match: (e: ClickupHttpError) => boolean;
  code: string;
  message: (e: ClickupHttpError) => string;
  suggestions?: (e: ClickupHttpError) => string[];
}

/** Pull the human-readable error message out of a ClickUp error JSON body. */
export function clickupErrorMessage(e: ClickupHttpError): string {
  const body = e.body;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record["err"] === "string") return record["err"];
    if (typeof record["error"] === "string") return record["error"];
    if (typeof record["message"] === "string") return record["message"];
    const ecd = record["ECODE"];
    if (typeof ecd === "string") return ecd;
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  return `HTTP ${e.status}`;
}

const patterns: ErrorPattern[] = [
  {
    match: (e) => e.status === 401,
    code: "AUTH_REQUIRED",
    message: () =>
      "ClickUp auth required — the token is missing, invalid, or expired (tokens start with 'pk_')",
    suggestions: () => [
      "Run `clickup-axi setup token` to write a fresh token to ~/.config/clickup-axi/token",
      "Or export CLICKUP_API_TOKEN=<pk_...>",
      "CI fallback uses AWS Secrets Manager `example-space/ci/tokens` key `CLICKUP_TOKEN`",
    ],
  },
  {
    match: (e) => e.status === 403,
    code: "FORBIDDEN",
    message: (e) => `Insufficient permissions for this ClickUp resource: ${clickupErrorMessage(e)}`,
    suggestions: () => [
      "Verify the token's workspace membership includes the target team/space",
      "Check the --team / --space IDs resolve to an accessible workspace",
    ],
  },
  {
    match: (e) => e.status === 429,
    code: "RATE_LIMITED",
    message: () => "ClickUp API rate limit hit (100 req/min) — backoff exhausted",
    suggestions: () => [
      "Wait ~60s before retrying",
      "Reduce page size with --per-page",
    ],
  },
  {
    match: (e) => e.status === 404,
    code: "NOT_FOUND",
    message: (e) => clickupErrorMessage(e),
    suggestions: (e) => [
      `Verify the ID (ClickUp IDs are opaque strings of digits). Body: ${clickupErrorMessage(e)}`,
      "Run `clickup-axi space list` / `clickup-axi folder list` / `clickup-axi list list` to browse the hierarchy",
    ],
  },
  {
    match: (e) => e.status === 400,
    code: "VALIDATION_ERROR",
    message: (e) => clickupErrorMessage(e),
  },
  {
    match: (e) => e.status === 409,
    code: "VALIDATION_ERROR",
    message: (e) => `Conflict: ${clickupErrorMessage(e)}`,
  },
  {
    match: (e) => e.status >= 400 && e.status < 500,
    code: "VALIDATION_ERROR",
    message: (e) => clickupErrorMessage(e),
  },
  {
    match: (e) => e.status >= 500,
    code: "UNKNOWN",
    message: (e) => `ClickUp API server error (HTTP ${e.status}): ${clickupErrorMessage(e)}`,
    suggestions: () => ["Retry shortly — the ClickUp API is likely transient"],
  },
];

/** Map a non-2xx ClickUp HTTP response into a structured AxiError. */
export function mapClickupError(e: ClickupHttpError): AxiError {
  for (const { match, code, message, suggestions } of patterns) {
    if (match(e)) {
      return new AxiError(message(e), code, suggestions?.(e) ?? []);
    }
  }
  return new AxiError(clickupErrorMessage(e), "UNKNOWN");
}

/** Returned when no token can be resolved from any source. */
export function noTokenError(): AxiError {
  return new AxiError(
    "No ClickUp API token found (env > ~/.config/clickup-axi/token > MCP config > AWS SM)",
    "AUTH_REQUIRED",
    [
      "Run `clickup-axi setup token` to configure the token",
      "Or export CLICKUP_API_TOKEN=<pk_...>",
    ],
  );
}
