import { get, post, put, del } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getFlag, getPositional, hasFlag, getAllFlags } from "../args.js";
import {
  field,
  joinArray,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from "../toon.js";
import { formatCountLine } from "../format.js";
import { getSuggestions } from "../suggestions.js";
import { resolveWriteGate, writeGateLabel } from "../writeGuard.js";
import type { ClickupContext } from "../context.js";

export const GROUP_HELP = `usage: clickup-axi group <subcommand> [flags]
subcommands[4]:
  list, create, update <id>, delete <id>
notes:
  ClickUp v2 calls User Groups "teams" in the path (/v2/team/<workspace>/group create, /v2/group/<id> update) — these are USER GROUPS within a workspace, not workspaces. All mutations default to --dry-run. Adding a guest view-only to a group converts them to a paid seat.
flags{list}:
  (none — returns all user groups the token can see across workspaces)
flags{create}:
  --name <text> (required), --team <id> (workspace, default EXAMPLE_ORG), --member <user-id> (repeatable, at least one required), --handle <slug>, --dry-run | --execute
flags{update}:
  --name <text>, --handle <slug>, --add-member <user-id> (repeatable), --remove-member <user-id> (repeatable), --dry-run | --execute
flags{delete}:
  --dry-run | --execute
examples:
  clickup-axi group list
  clickup-axi group create --name "On-call" --member 123 --member 456 --execute
  clickup-axi group update <id> --add-member 789 --execute`;

interface ClickupGroupMember {
  id?: number;
  username?: string;
  email?: string;
}

interface ClickupGroup {
  id: string;
  name?: string;
  team_id?: string | number;
  handle?: string;
  members?: ClickupGroupMember[];
  initial?: string;
  avatar?: string | null;
}

const listSchema: FieldDef<ClickupGroup>[] = [
  field("id"),
  field("name"),
  field("team_id", "workspace"),
  joinArray("members", "username", "members"),
];

async function listGroups(args: string[], ctx: ClickupContext): Promise<string> {
  void args;
  const body = await get<{ groups?: ClickupGroup[] }>(`/group`);
  const groups = body?.groups ?? [];
  return renderOutput([
    formatCountLine({ count: groups.length }),
    renderList("groups", groups, listSchema),
    renderHelp(getSuggestions({ domain: "group", action: "list", ctx })),
  ]);
}

async function createGroup(args: string[], ctx: ClickupContext): Promise<string> {
  const name = getFlag(args, "--name");
  if (!name) throw new AxiError("--name is required: clickup-axi group create --name \"...\"", "VALIDATION_ERROR");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const members = getAllFlags(args, "--member").map((m) => Number(m)).filter((n) => !isNaN(n));
  if (members.length === 0) throw new AxiError("--member <user-id> (repeatable, at least one) is required", "VALIDATION_ERROR");
  const handle = getFlag(args, "--handle");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { name, members };
  if (handle) payload["handle"] = handle;
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { name, team: teamId, status: writeGateLabel(gate), payload }, [
        field("name"),
        field("team"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this user group in ClickUp"]),
    ]);
  }
  const created = await post<{ team?: ClickupGroup }>(`/team/${teamId}/group`, payload);
  return renderOutput([
    renderDetail("created", { id: created.team?.id ?? null, name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "group", action: "create", id: created.team?.id, ctx })),
  ]);
}

async function updateGroup(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Group ID is required: clickup-axi group update <id>", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  const handle = getFlag(args, "--handle");
  const add = getAllFlags(args, "--add-member").map((m) => Number(m)).filter((n) => !isNaN(n));
  const rem = getAllFlags(args, "--remove-member").map((m) => Number(m)).filter((n) => !isNaN(n));
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = {};
  if (name) payload["name"] = name;
  if (handle) payload["handle"] = handle;
  if (add.length > 0 || rem.length > 0) payload["members"] = { add, rem };
  if (!gate.execute) {
    return renderOutput([
      renderDetail("update", { id, status: writeGateLabel(gate), payload }, [
        field("id"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to apply this update to ClickUp"]),
    ]);
  }
  await put(`/group/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "group", action: "create", id, ctx })),
  ]);
}

async function deleteGroup(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Group ID is required: clickup-axi group delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this user group in ClickUp"]),
    ]);
  }
  await del(`/group/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "group", action: "create", id, ctx })),
  ]);
}

export async function groupCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return GROUP_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listGroups(rest, ctx);
    case "create":
      return createGroup(rest, ctx);
    case "update":
      return updateGroup(rest, ctx);
    case "delete":
      return deleteGroup(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, create, update, delete",
      ]);
  }
}
