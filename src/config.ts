import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError, mapClickupError } from "./errors.js";

export { AxiError, mapClickupError };

/** ClickUp API v2 base URL. */
export const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";

/**
 * ClickUp API v3 base URL. ClickUp has moved Docs and Chat to v3; those
 * command groups wrap v3 explicitly and mark it in their help text. The v2
 * base remains the default for every other group.
 */
export const CLICKUP_API_V3_BASE = "https://api.clickup.com/api/v3";

/** ExampleSpace ClickUp coordinates (stable IDs; see the axi-suite-plan §4.2). */
export const DEFAULT_TEAM_ID = "1000000000"; // EXAMPLE_ORG team
export const DEFAULT_SPACE_ID = "200000000000"; // ExampleSpace space

/** Directory for tool-specific config (~/.config/clickup-axi by default). */
export function configDir(): string {
  return process.env["CLICKUP_AXI_CONFIG_DIR"] ?? join(homedir(), ".config", "clickup-axi");
}

/**
 * Resolve the ClickUp personal API token (starts with `pk_`).
 *
 * Priority order (per the captain's 2026-07-16 ruling on the COMPANY account):
 *   1. CLICKUP_API_TOKEN env var
 *   2. ~/.config/clickup-axi/token  (600-perm runtime copy)
 *   3. ~/.config/mcp/config.json  mcpServers.clickup.env.CLICKUP_API_TOKEN
 *
 * The AWS Secrets Manager fallback (`example-space/ci/tokens` / `aws --profile
 * example-space-staging`) was REMOVED: that key is a colleague's PERSONAL token and
 * must never be used against the captain's company workspace. Cold storage of
 * the captain's key is Vaultwarden (item "ClickUp API key - EXAMPLE_USER (personal)");
 * the runtime copy is the 600-perm token file (provisioned on this box).
 *
 * Never logs or returns the token except to the API client. Throws AxiError
 * (AUTH_REQUIRED) when no token can be resolved.
 */
export function resolveToken(): string {
  // 1. env var
  const envToken = (process.env["CLICKUP_API_TOKEN"] ?? "").trim();
  if (envToken) return envToken;

  // 2. tool-specific config file
  const tokenFile = tokenFilePath();
  if (existsSync(tokenFile)) {
    const fileToken = readFileSync(tokenFile, "utf8").trim();
    if (fileToken) return fileToken;
  }

  // 3. shared MCP config
  const mcpToken = readMcpConfigToken();
  if (mcpToken) return mcpToken;

  throw new AxiError(
    "No ClickUp API token found. Set CLICKUP_API_TOKEN (token starts with 'pk_'), " +
      "run `clickup-axi setup token`, or ensure ~/.config/mcp/config.json is configured.",
    "AUTH_REQUIRED",
    [
      "Run `clickup-axi setup token` to write the token to ~/.config/clickup-axi/token",
      "Or export CLICKUP_API_TOKEN=<pk_...> in the environment",
      "Cold storage of the captain's key is Vaultwarden (item 'ClickUp API key - EXAMPLE_USER (personal)')",
    ],
  );
}

/** Path to the tool-specific token file (~/.config/clickup-axi/token). */
export function tokenFilePath(): string {
  return join(configDir(), "token");
}

/** Path to the optional readonly-gate marker file (~/.config/clickup-axi/readonly). */
export function readonlyFilePath(): string {
  return join(configDir(), "readonly");
}

/** Path to the optional JSON config file (~/.config/clickup-axi/config.json). */
export function configJsonPath(): string {
  return join(configDir(), "config.json");
}

let cachedReadonly: boolean | null = null;

/**
 * Defense-in-depth readonly gate (captain ruling 2026-07-16, COMPANY account).
 *
 * When enforced, `--execute` itself refuses mutating calls. Enforced when ANY:
 *   - `CLICKUP_AXI_READONLY` env is `1`/`true` (test/CI override)
 *   - ~/.config/clickup-axi/readonly marker file exists (presence = enforced)
 *   - ~/.config/clickup-axi/config.json has `readonly: true`
 *
 * The recommended default posture is to ship the gate DOCUMENTED, not created:
 * the dry-run-by-default guard is the primary safety; this is opt-in defense in
 * depth for the captain to enable on the production runtime.
 */
export function isReadonlyEnforced(): boolean {
  if (cachedReadonly !== null) return cachedReadonly;
  const envFlag = (process.env["CLICKUP_AXI_READONLY"] ?? "").trim().toLowerCase();
  if (envFlag === "1" || envFlag === "true") {
    cachedReadonly = true;
    return true;
  }
  if (existsSync(readonlyFilePath())) {
    cachedReadonly = true;
    return true;
  }
  const cfg = configJsonPath();
  if (existsSync(cfg)) {
    try {
      const data = JSON.parse(readFileSync(cfg, "utf8"));
      if (data?.readonly === true) {
        cachedReadonly = true;
        return true;
      }
    } catch {
      // ignore malformed config
    }
  }
  cachedReadonly = false;
  return false;
}

/** Reset the cached readonly flag (tests / setup). */
export function resetReadonlyCache(): void {
  cachedReadonly = null;
}

/** Read the token from ~/.config/mcp/config.json mcpServers.clickup.env.CLICKUP_API_TOKEN. */
function readMcpConfigToken(): string | undefined {
  const cfg = join(homedir(), ".config", "mcp", "config.json");
  if (!existsSync(cfg)) return undefined;
  try {
    const data = JSON.parse(readFileSync(cfg, "utf8"));
    const token = data?.mcpServers?.clickup?.env?.CLICKUP_API_TOKEN;
    return typeof token === "string" ? token.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve the effective team ID. Priority: --team flag > env > default. */
export function resolveTeamId(flagValue?: string): string {
  if (flagValue) return flagValue;
  return process.env["FM_CLICKUP_TEAM"] ?? process.env["CLICKUP_TEAM_ID"] ?? DEFAULT_TEAM_ID;
}

/** Resolve the effective space ID. Priority: --space flag > env > default. */
export function resolveSpaceId(flagValue?: string): string {
  if (flagValue) return flagValue;
  return process.env["FM_CLICKUP_SPACE"] ?? process.env["CLICKUP_SPACE_ID"] ?? DEFAULT_SPACE_ID;
}
