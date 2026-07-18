import { resolveSpaceId, resolveTeamId } from "./config.js";
import { AxiError } from "./errors.js";

export interface ClickupContext {
  /** Team (workspace) ID — always resolved. */
  teamId: string;
  /** Space ID, resolved from flag/env/default. */
  spaceId: string;
  /** Folder ID, when --folder is given. */
  folderId?: string;
  /** List ID, when --list is given. */
  listId?: string;
}

export interface ParsedContextArgs {
  teamFlag: string | undefined;
  spaceFlag: string | undefined;
  folderFlag: string | undefined;
  listFlag: string | undefined;
  pathFlag: string | undefined;
  strippedArgs: string[];
}

const CONTEXT_FLAGS: Record<string, true> = {
  "--team": true,
  "--space": true,
  "--folder": true,
  "--list": true,
  "--path": true,
};

/**
 * Strip --team/--space/--folder/--list/--path (space or equals form) from args.
 *
 * These are routing flags consumed by every command; they are never passed
 * to the ClickUp API as raw query params. Each accepts space or equals form.
 * `--path` is resolved into --space/--folder/--list IDs by name at runtime
 * (see hierarchy.ts), so it is stripped here and applied in withContext().
 */
export function parseContextArgs(args: string[]): ParsedContextArgs {
  const stripped: string[] = [];
  let teamFlag: string | undefined;
  let spaceFlag: string | undefined;
  let folderFlag: string | undefined;
  let listFlag: string | undefined;
  let pathFlag: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    let handled = false;
    for (const flag of Object.keys(CONTEXT_FLAGS)) {
      const equalsPrefix = `${flag}=`;
      if (arg === flag) {
        const value = args[index + 1];
        assignFlag(flag, value);
        index++;
        handled = true;
        break;
      }
      if (arg.startsWith(equalsPrefix)) {
        assignFlag(flag, arg.slice(equalsPrefix.length));
        handled = true;
        break;
      }
    }
    if (!handled) stripped.push(arg);
  }
  return { teamFlag, spaceFlag, folderFlag, listFlag, pathFlag, strippedArgs: stripped };

  function assignFlag(flag: string, value: string | undefined): void {
    switch (flag) {
      case "--team":
        teamFlag = value;
        break;
      case "--space":
        spaceFlag = value;
        break;
      case "--folder":
        folderFlag = value;
        break;
      case "--list":
        listFlag = value;
        break;
      case "--path":
        pathFlag = value;
        break;
    }
  }
}

/**
 * Build the ClickupContext from parsed routing flags, applying env/default
 * resolution for team and space. Folder/list are optional overrides.
 */
export function buildContext(parsed: ParsedContextArgs): ClickupContext {
  const ctx: ClickupContext = {
    teamId: resolveTeamId(parsed.teamFlag),
    spaceId: resolveSpaceId(parsed.spaceFlag),
  };
  if (parsed.folderFlag) ctx.folderId = parsed.folderFlag;
  if (parsed.listFlag) ctx.listId = parsed.listFlag;
  return ctx;
}

/**
 * Resolve a ClickUp list ID from explicit --list flag, --folder, or by
 * looking up the first list in the configured space. Used by task commands
 * that need a concrete list to operate on.
 */
export async function resolveListId(
  ctx: ClickupContext,
  getLists: (spaceId: string) => Promise<{ id: string; name: string }[]>,
): Promise<string | undefined> {
  if (ctx.listId) return ctx.listId;
  try {
    const lists = await getLists(ctx.spaceId);
    return lists[0]?.id;
  } catch {
    return undefined;
  }
}

// ── per-command flag validation (AXI principle 6: fail loud on unknown flags) ─

/**
 * Flags allowed on every command. --team/--space/--folder/--list/--path are
 * context flags stripped by parseContextArgs/withContext before a command sees
 * them; --help always passes. All are never reported as unknown.
 */
const GLOBAL_FLAGS = new Set(["--help", "--team", "--space", "--folder", "--list", "--path"]);

/**
 * Reject unknown flags before any dependency call (exit 2). Globals
 * (context flags, already stripped, plus --help) are always allowed.
 * Lists the command's valid flags inline so the agent self-corrects in
 * one turn — mirroring tg-axi's rejectUnknownFlags.
 */
export function rejectUnknownFlags(args: string[], known: string[], commandPath: string): void {
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (known.includes(name) || GLOBAL_FLAGS.has(name)) continue;
    throw new AxiError(`unknown flag ${name} for \`${commandPath}\``, "VALIDATION_ERROR", [
      `valid flags for \`${commandPath}\`: ${[...known, "--help"].join(", ")}`,
      "(--help always allowed; context flags are placed after the command)",
    ]);
  }
}
