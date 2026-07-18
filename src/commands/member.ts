import { get, post, del } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getFlag, getPositional, hasFlag } from "../args.js";
import {
  field,
  custom,
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
import { rejectUnknownFlags, type ClickupContext } from "../context.js";

export const MEMBER_HELP = `usage: clickup-axi member <subcommand> [flags]
subcommands[6]:
  task, list, guest <id>, guest-invite, guest-add, guest-remove
notes:
  guest-* subcommands are ENTERPRISE-PLAN ONLY; the company workspace must be on Enterprise or ClickUp returns FORBIDDEN. All guest mutations default to --dry-run.
flags{task}:
  --task <id> (required)
flags{list}:
  --list <id> (required)
flags{guest}:
  --team <id> (default: resolved EXAMPLE_ORG team)
flags{guest-invite}:
  --email <email> (required), --can-edit-tags, --can-see-time-spent, --can-see-time-estimated, --can-create-views, --custom-role <id>, --dry-run | --execute
flags{guest-add/guest-remove}:
  --guest <id> (required), --task <id> | --list <id> | --folder <id> (one required, scope), --dry-run | --execute
examples:
  clickup-axi member task --task <id>
  clickup-axi member list --list <id>
  clickup-axi member guest-invite --email partner@example.com --execute`;

interface ClickupMember {
  id?: number;
  username?: string;
  email?: string;
  role?: number;
}

const memberSchema: FieldDef<ClickupMember>[] = [
  field("id"),
  field("username"),
  field("email"),
  custom("role", (m) =>
    m.role === 1
      ? "owner"
      : m.role === 2
        ? "admin"
        : m.role === 3
          ? "member"
          : m.role === 4
            ? "guest"
            : String(m.role ?? "unknown"),
  ),
];

async function taskMembers(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--task"], "member task");
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const body = await get<{ members?: ClickupMember[] }>(`/task/${taskId}/member`);
  const members = body?.members ?? [];
  return renderOutput([
    formatCountLine({ count: members.length }),
    renderList("members", members, memberSchema),
    renderHelp(getSuggestions({ domain: "member", action: "list", id: taskId, ctx })),
  ]);
}

async function listMembers(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--list"], "member list");
  const listId = getFlag(args, "--list") ?? ctx.listId;
  if (!listId) throw new AxiError("--list <id> is required", "VALIDATION_ERROR");
  const body = await get<{ members?: ClickupMember[] }>(`/list/${listId}/member`);
  const members = body?.members ?? [];
  return renderOutput([
    formatCountLine({ count: members.length }),
    renderList("members", members, memberSchema),
    renderHelp(getSuggestions({ domain: "member", action: "list", id: listId, ctx })),
  ]);
}

async function viewGuest(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--team"], "member guest");
  const id = getPositional(args, 0);
  if (!id)
    throw new AxiError("Guest ID is required: clickup-axi member guest <id>", "VALIDATION_ERROR");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const guest = await get<ClickupMember>(`/team/${teamId}/guest/${id}`);
  return renderOutput([
    renderDetail("guest", guest, memberSchema),
    renderHelp(getSuggestions({ domain: "member", action: "list", id, ctx })),
  ]);
}

async function inviteGuest(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    [
      "--email",
      "--can-edit-tags",
      "--can-see-time-spent",
      "--can-see-time-estimated",
      "--can-create-views",
      "--can-see-points-estimated",
      "--custom-role",
      "--execute",
      "--dry-run",
    ],
    "member guest-invite",
  );
  const email = getFlag(args, "--email");
  if (!email) throw new AxiError("--email <email> is required", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { email };
  if (hasFlag(args, "--can-edit-tags")) payload["can_edit_tags"] = true;
  if (hasFlag(args, "--can-see-time-spent")) payload["can_see_time_spent"] = true;
  if (hasFlag(args, "--can-see-time-estimated")) payload["can_see_time_estimated"] = true;
  if (hasFlag(args, "--can-create-views")) payload["can_create_views"] = true;
  if (hasFlag(args, "--can-see-points-estimated")) payload["can_see_points_estimated"] = true;
  const customRole = getFlag(args, "--custom-role");
  if (customRole) payload["custom_role_id"] = Number(customRole);
  if (!gate.execute) {
    return renderOutput([
      renderDetail("guest-invite", { team: ctx.teamId, status: writeGateLabel(gate), payload }, [
        field("team"),
        field("status"),
        field("payload"),
      ]),
      renderHelp([
        "Add --execute to invite this guest to the ClickUp workspace (Enterprise plan required)",
      ]),
    ]);
  }
  const created = await post<{ guest?: { id?: number; username?: string; email?: string } }>(
    `/team/${ctx.teamId}/guest`,
    payload,
  );
  return renderOutput([
    renderDetail("invited", { id: created.guest?.id ?? null, email, status: "ok" }, [
      field("id"),
      field("email"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "member", action: "create", ctx })),
  ]);
}

interface GuestScope {
  path: string;
  scope: string;
}

function resolveGuestScope(args: string[], ctx: ClickupContext): GuestScope | undefined {
  const taskId = getFlag(args, "--task");
  if (taskId) return { path: `/task/${taskId}/guest`, scope: "task" };
  const listId = getFlag(args, "--list") ?? ctx.listId;
  if (listId) return { path: `/list/${listId}/guest`, scope: "list" };
  const folderId = getFlag(args, "--folder") ?? ctx.folderId;
  if (folderId) return { path: `/folder/${folderId}/guest`, scope: "folder" };
  return undefined;
}

async function addGuest(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--guest", "--task", "--list", "--folder", "--execute", "--dry-run"],
    "member guest-add",
  );
  const guestId = getFlag(args, "--guest");
  if (!guestId) throw new AxiError("--guest <id> is required", "VALIDATION_ERROR");
  const scope = resolveGuestScope(args, ctx);
  if (!scope)
    throw new AxiError(
      "--task <id> | --list <id> | --folder <id> is required to scope the guest",
      "VALIDATION_ERROR",
    );
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail(
        "guest-add",
        { guest: guestId, scope: scope.scope, status: writeGateLabel(gate) },
        [field("guest"), field("scope"), field("status")],
      ),
      renderHelp([
        "Add --execute to share this with the guest in ClickUp (Enterprise plan required)",
      ]),
    ]);
  }
  await post(`${scope.path}/${guestId}`, {});
  return renderOutput([
    renderDetail("added", { guest: guestId, scope: scope.scope, status: "ok" }, [
      field("guest"),
      field("scope"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "member", action: "create", id: guestId, ctx })),
  ]);
}

async function removeGuest(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--guest", "--task", "--list", "--folder", "--execute", "--dry-run"],
    "member guest-remove",
  );
  const guestId = getFlag(args, "--guest");
  if (!guestId) throw new AxiError("--guest <id> is required", "VALIDATION_ERROR");
  const scope = resolveGuestScope(args, ctx);
  if (!scope)
    throw new AxiError(
      "--task <id> | --list <id> | --folder <id> is required to scope the guest",
      "VALIDATION_ERROR",
    );
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail(
        "guest-remove",
        { guest: guestId, scope: scope.scope, status: writeGateLabel(gate) },
        [field("guest"), field("scope"), field("status")],
      ),
      renderHelp([
        "Add --execute to revoke this guest's access in ClickUp (Enterprise plan required)",
      ]),
    ]);
  }
  await del(`${scope.path}/${guestId}`);
  return renderOutput([
    renderDetail("removed", { guest: guestId, scope: scope.scope, status: "ok" }, [
      field("guest"),
      field("scope"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "member", action: "create", id: guestId, ctx })),
  ]);
}

export async function memberCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return MEMBER_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "task":
      return taskMembers(rest, ctx);
    case "list":
      return listMembers(rest, ctx);
    case "guest":
      return viewGuest(rest, ctx);
    case "guest-invite":
      return inviteGuest(rest, ctx);
    case "guest-add":
      return addGuest(rest, ctx);
    case "guest-remove":
      return removeGuest(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: task, list, guest, guest-invite, guest-add, guest-remove",
      ]);
  }
}
