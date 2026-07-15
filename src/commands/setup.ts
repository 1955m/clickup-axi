import { installSessionStartHooks } from "axi-sdk-js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderHelp, renderOutput, renderError } from "../toon.js";
import { tokenFilePath, resolveTeamId, resolveSpaceId } from "../config.js";
import { readStdin, isStdinTTY } from "../stdin.js";
import { get } from "../clickup.js";
import type { ClickupContext } from "../context.js";

export const SETUP_HELP = `usage: clickup-axi setup <action>
Configure the ClickUp API token or install agent SessionStart hooks.
  setup token              write a token to ~/.config/clickup-axi/token (pipe via stdin)
  setup auth               verify the resolved token + show the authorized user
  setup workspace          print the resolved team/space coordinates
  setup hooks              install agent SessionStart hooks for ambient context
examples:
  echo -n "pk_..." | clickup-axi setup token
  clickup-axi setup auth
  clickup-axi setup hooks`;

export async function setupCommand(args: string[], _ctx: ClickupContext | undefined): Promise<string> {
  const action = args[0];
  if (action === "hooks") {
    installSessionStartHooks();
    return renderOutput([
      "hooks:\n  status: installed\n  integrations: Claude Code, Codex, OpenCode",
      renderHelp(["Restart your agent session to receive clickup-axi ambient context"]),
    ]);
  }
  if (action === "token") {
    if (isStdinTTY()) {
      return renderError(
        "Pipe the token via stdin — never pass it as a CLI arg: echo -n \"pk_...\" | clickup-axi setup token",
        "VALIDATION_ERROR",
        ["The token is written to ~/.config/clickup-axi/token (chmod 600)"],
      );
    }
    const token = (await readStdin()).trim();
    if (!token) {
      return renderError("No token received on stdin", "VALIDATION_ERROR");
    }
    if (!token.startsWith("pk_")) {
      return renderError(
        `Token does not look like a ClickUp personal token (expected "pk_" prefix, got "${token.slice(0, 3)}...")`,
        "VALIDATION_ERROR",
      );
    }
    const path = tokenFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, token, { mode: 0o600 });
    return renderOutput([
      `token:\n  path: ${path}\n  status: written`,
      renderHelp(["Run `clickup-axi setup auth` to verify"]),
    ]);
  }
  if (action === "auth" || action === undefined) {
    let user: { user?: { id?: number; username?: string; email?: string } } | undefined;
    try {
      user = await get<{ user?: { id?: number; username?: string; email?: string } }>(`/user`);
    } catch {
      // fall through; the error path is rendered below
    }
    if (!user?.user) {
      return renderError(
        "Could not authenticate to ClickUp with the resolved token",
        "AUTH_REQUIRED",
        ["Run `echo -n \"pk_...\" | clickup-axi setup token`", "Or export CLICKUP_API_TOKEN=<pk_...>"],
      );
    }
    return renderOutput([
      `auth:\n  user_id: ${user.user.id ?? "unknown"}\n  username: ${user.user.username ?? "unknown"}\n  email: ${user.user.email ?? "unknown"}`,
      renderHelp(["Token resolves via env > ~/.config/clickup-axi/token > MCP config > AWS SM"]),
    ]);
  }
  if (action === "workspace") {
    return renderOutput([
      `workspace:\n  team_id: ${resolveTeamId()}\n  space_id: ${resolveSpaceId()}`,
      `token_file:\n  path: ${tokenFilePath()}\n  present: ${existsSync(tokenFilePath())}`,
      renderHelp(["Override with --team / --space flags or FM_CLICKUP_TEAM / FM_CLICKUP_SPACE env"]),
    ]);
  }
  return renderError(`Unknown setup action: ${action}`, "VALIDATION_ERROR", [
    "Run `clickup-axi setup token`, `setup auth`, `setup workspace`, or `setup hooks`",
  ]);
}
