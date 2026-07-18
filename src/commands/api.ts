import { encode } from "@toon-format/toon";
import { request } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getAllFlags, takeFlag } from "../args.js";
import { cleanBody } from "../body.js";
import { rejectUnknownFlags, type ClickupContext } from "../context.js";

export const API_HELP = `usage: clickup-axi api [<method>] <path>
description: Make an authenticated ClickUp API v2 request. Defaults to GET.
methods[5]:
  GET, POST, PUT, PATCH, DELETE
flags[3]:
  --query <key=value> (repeatable), --body <json-text> or --body-file <path>, --header <key:value> (repeatable)
examples:
  clickup-axi api "user"
  clickup-axi api GET "team/1000000000/space?archived=false"
  clickup-axi api POST "list/123/task" --body '{"name":"New task"}'
  clickup-axi api "task/abc123" --query include=["subtasks"]`;

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const STRING_VALUE_TRUNCATION_LIMIT = 2000;
const LONG_STRING_CLEANUP_THRESHOLD = 200;

export async function apiCommand(args: string[], _ctx: ClickupContext): Promise<string> {
  if (args[0] === "--help" || args.length === 0) return API_HELP;
  rejectUnknownFlags(args, ["--query", "-q", "--header", "-H", "--body", "--body-file"], "api");

  // Positionals: optional method then path. Flags: --query/-q, --body/--body-file, --header/-H.
  const positionals: string[] = [];
  const valueFlags = new Set(["--query", "-q", "--header", "-H", "--body", "--body-file"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--") || (a.startsWith("-") && a.length > 1)) {
      if (valueFlags.has(a) || valueFlags.has(a.split("=", 1)[0])) {
        if (!a.includes("=")) i++;
      }
      continue;
    }
    positionals.push(a);
  }

  let method: string;
  let path: string;
  if (positionals.length >= 2 && HTTP_METHODS.has(positionals[0].toUpperCase())) {
    method = positionals[0].toUpperCase();
    path = positionals[1];
  } else if (positionals.length >= 1) {
    method = "GET";
    path = positionals[0];
  } else {
    throw new AxiError(
      "API path is required: clickup-axi api [<method>] <path>",
      "VALIDATION_ERROR",
    );
  }

  // Build query params from repeatable --query key=value (only the value side
  // is URL-encoded; the key is passed through so callers can send array keys
  // like statuses[]=open).
  const queryPairs = getAllFlags(args, "--query").concat(getAllFlags(args, "-q"));
  const params: Record<string, string> = {};
  for (const pair of queryPairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new AxiError(
        `Invalid --query value: ${pair}. Use --query key=value`,
        "VALIDATION_ERROR",
      );
    }
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    params[key] = value;
  }

  // Body: --body <json-text> (parsed so the wire request sends real JSON) or
  // --body-file <path>. Omit for GET/DELETE.
  const bodyText = takeFlag(args, "--body") ?? takeFlag(args, "--body-file");
  let parsedBody: unknown;
  if (bodyText !== undefined) {
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      parsedBody = bodyText;
    }
  }

  const headerPairs = getAllFlags(args, "--header").concat(getAllFlags(args, "-H"));
  const headers: Record<string, string> = {};
  for (const pair of headerPairs) {
    const colon = pair.indexOf(":");
    if (colon <= 0) {
      throw new AxiError(
        `Invalid --header value: ${pair}. Use --header Key:Value`,
        "VALIDATION_ERROR",
      );
    }
    headers[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim();
  }

  const resp = await request<unknown>({
    path: path.startsWith("/") ? path : `/${path}`,
    method,
    params,
    body: parsedBody,
    headers,
  });

  const cleaned = stripNoisyFields(resp.body);
  return encode({ status: resp.status, api_response: cleaned });
}

/** Fields from raw ClickUp API responses that are noisy/useless for agents. */
const NOISY_KEYS = new Set([
  "avatar",
  "profilePicture",
  "color",
  "initials",
  "week_start_day",
  "global_font_support",
  "rid",
  "schema",
  "team_sidebar",
  "integration",
]);

function stripNoisyFields(obj: unknown, depth = 0): unknown {
  if (depth > 8) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => stripNoisyFields(item, depth + 1));
  }
  if (obj !== null && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (NOISY_KEYS.has(key)) continue;
      result[key] = stripNoisyFields(value, depth + 1);
    }
    return result;
  }
  if (typeof obj === "string" && obj.length > LONG_STRING_CLEANUP_THRESHOLD) {
    const s = cleanBody(obj);
    if (s.length > STRING_VALUE_TRUNCATION_LIMIT) {
      return s.slice(0, STRING_VALUE_TRUNCATION_LIMIT) + "... (truncated)";
    }
    return s;
  }
  return obj;
}
