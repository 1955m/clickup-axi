import { get } from "../clickup.js";
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
import type { ClickupContext } from "../context.js";

export const WORKSPACE_HELP = `usage: clickup-axi workspace <subcommand>
subcommands[7]:
  list, view <id>, seats, plan, shared, custom-roles, custom-items
examples:
  clickup-axi workspace list
  clickup-axi workspace view 1000000000
  clickup-axi workspace seats
  clickup-axi workspace shared`;

interface ClickupTeam {
  id: string;
  name: string;
  color?: string;
  avatar?: string | null;
}

interface SharedNode {
  id?: string;
  name?: string;
}

const listSchema: FieldDef<ClickupTeam>[] = [field("id"), field("name")];
const viewSchema: FieldDef<ClickupTeam>[] = [field("id"), field("name")];
const sharedListSchema: FieldDef<SharedNode>[] = [field("id"), field("name")];

async function listWorkspaces(args: string[], ctx: ClickupContext): Promise<string> {
  // The ClickUp /team endpoint returns the teams the token belongs to. It
  // accepts no pagination params.
  void args;
  const body = await get<{ teams?: ClickupTeam[] }>("/team");
  const list = body?.teams ?? [];
  const suggestions = getSuggestions({ domain: "workspace", action: "list", isEmpty: list.length === 0, ctx });
  return renderOutput([
    formatCountLine({ count: list.length }),
    renderList("workspaces", list, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewWorkspace(args: string[], ctx: ClickupContext): Promise<string> {
  const id = args[0];
  if (!id) return renderError("Workspace/team ID is required: clickup-axi workspace view <id>", "VALIDATION_ERROR");
  const team = await get<ClickupTeam>(`/team/${id}`);
  return renderOutput([
    renderDetail("workspace", team, viewSchema),
    renderHelp(getSuggestions({ domain: "workspace", action: "view", id, ctx })),
  ]);
}

async function workspaceSeats(args: string[], ctx: ClickupContext): Promise<string> {
  void args;
  const body = await get<{ members?: { filled_members_seats?: number; total_member_seats?: number; empty_member_seats?: number }; guests?: { filled_guests_seats?: number; total_guests_seats?: number; empty_guests_seats?: number } }>(
    `/team/${ctx.teamId}/seats`,
  );
  const seats = {
    members: `${body?.members?.filled_members_seats ?? 0}/${body?.members?.total_member_seats ?? 0}`,
    guests: `${body?.guests?.filled_guests_seats ?? 0}/${body?.guests?.total_guests_seats ?? 0}`,
  };
  return renderOutput([
    renderDetail("seats", seats, [field("members"), field("guests")]),
    renderHelp(getSuggestions({ domain: "workspace", action: "view", ctx })),
  ]);
}

async function workspacePlan(args: string[], ctx: ClickupContext): Promise<string> {
  void args;
  const body = await get<{ plan_name?: string; plan_id?: number }>(`/team/${ctx.teamId}/plan`);
  return renderOutput([
    renderDetail("plan", { name: body?.plan_name ?? "unknown", id: body?.plan_id ?? null }, [field("name"), field("id")]),
    renderHelp(getSuggestions({ domain: "workspace", action: "view", ctx })),
  ]);
}

async function workspaceShared(args: string[], ctx: ClickupContext): Promise<string> {
  void args;
  const body = await get<{ shared?: { tasks?: string[]; lists?: SharedNode[]; folders?: SharedNode[] } }>(
    `/team/${ctx.teamId}/shared`,
  );
  const shared = body?.shared ?? { tasks: [], lists: [], folders: [] };
  const taskIds = shared.tasks ?? [];
  const lists = shared.lists ?? [];
  const folders = shared.folders ?? [];
  return renderOutput([
    renderDetail("shared", { tasks: taskIds.length, lists: lists.length, folders: folders.length }, [
      field("tasks"),
      field("lists"),
      field("folders"),
    ]),
    lists.length ? renderList("shared_lists", lists, sharedListSchema) : undefined,
    folders.length ? renderList("shared_folders", folders, sharedListSchema) : undefined,
    renderHelp(getSuggestions({ domain: "workspace", action: "view", ctx })),
  ]);
}

async function customRoles(args: string[], ctx: ClickupContext): Promise<string> {
  void args;
  const body = await get<{ custom_roles?: { id?: number; name?: string; inherited_role?: number }[] }>(
    `/team/${ctx.teamId}/customroles`,
  );
  const roles = body?.custom_roles ?? [];
  const schema: FieldDef<{ id?: number; name?: string; inherited_role?: number }>[] = [
    field("id"),
    field("name"),
    custom("inherited_role", (r) => (r.inherited_role === 1 ? "owner" : r.inherited_role === 2 ? "admin" : r.inherited_role === 3 ? "member" : r.inherited_role === 4 ? "guest" : String(r.inherited_role ?? "unknown"))),
  ];
  return renderOutput([
    formatCountLine({ count: roles.length }),
    renderList("custom_roles", roles, schema),
    renderHelp(getSuggestions({ domain: "workspace", action: "view", ctx })),
  ]);
}

async function customItems(args: string[], ctx: ClickupContext): Promise<string> {
  void args;
  const body = await get<{ custom_items?: { id?: number; name?: string }[] }>(`/team/${ctx.teamId}/custom_item`);
  const items = body?.custom_items ?? [];
  const schema: FieldDef<{ id?: number; name?: string }>[] = [field("id"), field("name")];
  return renderOutput([
    formatCountLine({ count: items.length }),
    renderList("custom_items", items, schema),
    renderHelp(getSuggestions({ domain: "workspace", action: "view", ctx })),
  ]);
}

export async function workspaceCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return WORKSPACE_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listWorkspaces(rest, ctx);
    case "view":
      return viewWorkspace(rest, ctx);
    case "seats":
      return workspaceSeats(rest, ctx);
    case "plan":
      return workspacePlan(rest, ctx);
    case "shared":
      return workspaceShared(rest, ctx);
    case "custom-roles":
      return customRoles(rest, ctx);
    case "custom-items":
      return customItems(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, seats, plan, shared, custom-roles, custom-items",
      ]);
  }
}
