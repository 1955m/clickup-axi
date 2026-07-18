import { get, post, put, del } from "../clickup.js";
import { AxiError } from "../errors.js";
import { takeFlag, getPositional, hasFlag } from "../args.js";
import {
  field,
  boolYesNo,
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

export const VIEW_HELP = `usage: clickup-axi view <subcommand> [flags]
subcommands[6]:
  list, get <id>, create, update <id>, delete <id>, tasks <id>
flags{list}:
  --space <id>, --folder <id>, --list <id> (scope to a hierarchy node; --view-type <type> filter), --archived
flags{create}:
  --name <text> (required), --type <list|board|calendar|table|timeline|workload|activity|map|chat|gantt> (required), --space <id> | --folder <id> | --list <id> | --team <id> (scope; default --team workspace-level), --dry-run | --execute
flags{update}:
  --name <text>, --dry-run | --execute
flags{delete}:
  --dry-run | --execute
flags{tasks}:
  --page <n>
examples:
  clickup-axi view list --space <id>
  clickup-axi view get <id>
  clickup-axi view create --name "Sprint board" --type board --space <id> --execute
  clickup-axi view tasks <id>`;

interface ClickupView {
  id: string;
  name: string;
  type?: string;
  orderindex?: number;
  archived?: boolean;
  team?: { id?: string };
  group_divider?: { collapsed?: boolean };
}

const listSchema: FieldDef<ClickupView>[] = [
  field("id"),
  field("name"),
  field("type"),
  boolYesNo("archived"),
];
const viewSchema: FieldDef<ClickupView>[] = [
  field("id"),
  field("name"),
  field("type"),
  field("orderindex"),
];

function scopeEndpoint(args: string[], ctx: ClickupContext): { path: string; scope: string } {
  const viewId = takeFlag(args, "--view");
  if (viewId) return { path: `/view/${viewId}/view`, scope: "view" };
  const listId = takeFlag(args, "--list") ?? ctx.listId;
  if (listId) return { path: `/list/${listId}/view`, scope: "list" };
  const folderId = takeFlag(args, "--folder") ?? ctx.folderId;
  if (folderId) return { path: `/folder/${folderId}/view`, scope: "folder" };
  const spaceId = takeFlag(args, "--space") ?? ctx.spaceId;
  return { path: `/space/${spaceId}/view`, scope: "space" };
}

async function listViews(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--view", "--list", "--folder", "--space", "--archived", "--view-type"],
    "view list",
  );
  const { path } = scopeEndpoint(args, ctx);
  const body = await get<{ views?: ClickupView[] }>(path);
  const list = body?.views ?? [];
  const isEmpty = list.length === 0;
  const suggestions = getSuggestions({ domain: "view", action: "list", isEmpty, ctx });
  return renderOutput([
    formatCountLine({ count: list.length }),
    renderList("views", list, listSchema),
    renderHelp(suggestions),
  ]);
}

async function getView(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, [], "view get");
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("View ID is required: clickup-axi view get <id>", "VALIDATION_ERROR");
  const view = await get<ClickupView>(`/view/${id}`);
  return renderOutput([
    renderDetail("view", view, viewSchema),
    renderHelp(getSuggestions({ domain: "view", action: "get", id, ctx })),
  ]);
}

interface ClickupTaskSummary {
  id: string;
  name: string;
  status?: { status?: string };
}

const taskSummarySchema: FieldDef<ClickupTaskSummary>[] = [
  field("id"),
  field("name"),
  custom("status", (t) => t.status?.status ?? "none"),
];

async function viewTasks(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--page"], "view tasks");
  const id = getPositional(args, 0);
  if (!id)
    throw new AxiError("View ID is required: clickup-axi view tasks <id>", "VALIDATION_ERROR");
  const page = takeFlag(args, "--page") ?? "0";
  const body = await get<{ tasks?: ClickupTaskSummary[] }>(`/view/${id}/task`, { page });
  const tasks = body?.tasks ?? [];
  return renderOutput([
    formatCountLine({ count: tasks.length }),
    renderList("tasks", tasks, taskSummarySchema),
    renderHelp(getSuggestions({ domain: "view", action: "tasks", id, ctx })),
  ]);
}

async function createView(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--name", "--type", "--list", "--folder", "--space", "--team", "--execute", "--dry-run"],
    "view create",
  );
  const name = takeFlag(args, "--name");
  if (!name)
    throw new AxiError(
      '--name is required: clickup-axi view create --name "..."',
      "VALIDATION_ERROR",
    );
  const type = takeFlag(args, "--type");
  if (!type)
    throw new AxiError(
      "--type <list|board|calendar|table|timeline|workload|activity|map|chat|gantt> is required",
      "VALIDATION_ERROR",
    );
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  // Scope: explicit --list/--folder/--space take priority; --team (default resolved) = workspace-level view.
  const listId = takeFlag(args, "--list") ?? ctx.listId;
  const folderId = takeFlag(args, "--folder") ?? ctx.folderId;
  const spaceId = takeFlag(args, "--space") ?? ctx.spaceId;
  const teamId = takeFlag(args, "--team") ?? ctx.teamId;
  let path: string;
  let scope: string;
  if (listId) {
    path = `/list/${listId}/view`;
    scope = "list";
  } else if (folderId) {
    path = `/folder/${folderId}/view`;
    scope = "folder";
  } else if (spaceId && !takeFlag(args, "--team")) {
    path = `/space/${spaceId}/view`;
    scope = "space";
  } else {
    path = `/team/${teamId}/view`;
    scope = "team";
  }
  const payload: Record<string, unknown> = { name, type };
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { name, type, scope, status: writeGateLabel(gate), payload }, [
        field("name"),
        field("type"),
        field("scope"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this view in ClickUp"]),
    ]);
  }
  const created = await post<ClickupView>(path, payload);
  return renderOutput([
    renderDetail("created", { id: created.id ?? null, name, type, status: "ok" }, [
      field("id"),
      field("name"),
      field("type"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "view", action: "create", id: created.id, ctx })),
  ]);
}

async function updateView(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--name", "--execute", "--dry-run"], "view update");
  const id = getPositional(args, 0);
  if (!id)
    throw new AxiError("View ID is required: clickup-axi view update <id>", "VALIDATION_ERROR");
  const name = takeFlag(args, "--name");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = {};
  if (name) payload["name"] = name;
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
  await put(`/view/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "view", action: "create", id, ctx })),
  ]);
}

async function deleteView(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--execute", "--dry-run"], "view delete");
  const id = getPositional(args, 0);
  if (!id)
    throw new AxiError("View ID is required: clickup-axi view delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this view in ClickUp"]),
    ]);
  }
  await del(`/view/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "view", action: "create", id, ctx })),
  ]);
}

export async function viewCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return VIEW_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listViews(rest, ctx);
    case "get":
      return getView(rest, ctx);
    case "create":
      return createView(rest, ctx);
    case "update":
      return updateView(rest, ctx);
    case "delete":
      return deleteView(rest, ctx);
    case "tasks":
      return viewTasks(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, get, create, update, delete, tasks",
      ]);
  }
}
