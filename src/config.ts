import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError, mapClickupError } from "./errors.js";

export { AxiError, mapClickupError };

/** ClickUp API v2 base URL. */
export const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";

/** ExampleSpace ClickUp coordinates (stable IDs; see the axi-suite-plan §4.2). */
export const DEFAULT_TEAM_ID = "1000000000"; // EXAMPLE_ORG team
export const DEFAULT_SPACE_ID = "200000000000"; // ExampleSpace space

/** AWS Secrets Manager coordinates for the CI token store. */
export const AWS_SECRET_ID = "example-space/ci/tokens";
export const AWS_SECRET_KEY = "CLICKUP_TOKEN";
export const AWS_PROFILE = "example-space-staging";

/**
 * Resolve the ClickUp personal API token (starts with `pk_`).
 *
 * Priority order (per axi-suite-plan §4.5):
 *   1. CLICKUP_API_TOKEN env var
 *   2. ~/.config/clickup-axi/token
 *   3. ~/.config/mcp/config.json  mcpServers.clickup.env.CLICKUP_API_TOKEN
 *   4. AWS Secrets Manager `example-space/ci/tokens` key `CLICKUP_TOKEN`
 *      via `aws --profile example-space-staging secretsmanager get-secret-value`
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

  // 4. AWS Secrets Manager (CI/CD fallback). Spawns `aws` (read-only
  // get-secret-value). The token never touches the process argv.
  const awsToken = readAwsSecretToken();
  if (awsToken) return awsToken;

  throw new AxiError(
    "No ClickUp API token found. Set CLICKUP_API_TOKEN (token starts with 'pk_'), " +
      "run `clickup-axi setup token`, or ensure AWS Secrets Manager access.",
    "AUTH_REQUIRED",
    [
      "Run `clickup-axi setup token` to write the token to ~/.config/clickup-axi/token",
      "Or export CLICKUP_API_TOKEN=<pk_...> in the environment",
      "CI fallback: `aws --profile example-space-staging secretsmanager get-secret-value --secret-id example-space/ci/tokens` must be reachable",
    ],
  );
}

/** Path to the tool-specific token file (~/.config/clickup-axi/token). */
export function tokenFilePath(): string {
  const dir = process.env["CLICKUP_AXI_CONFIG_DIR"] ?? join(homedir(), ".config", "clickup-axi");
  return join(dir, "token");
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

/** Read the CLICKUP_TOKEN key from AWS Secrets Manager via the AWS CLI. */
function readAwsSecretToken(): string | undefined {
  try {
    const raw = execFileSync(
      "aws",
      [
        "--profile",
        AWS_PROFILE,
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        AWS_SECRET_ID,
        "--query",
        "SecretString",
        "--output",
        "text",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 },
    ).trim();
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      const token = parsed?.[AWS_SECRET_KEY];
      return typeof token === "string" ? token.trim() : undefined;
    } catch {
      return undefined;
    }
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
