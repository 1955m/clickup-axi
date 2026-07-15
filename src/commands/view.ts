import { get } from "../clickup.js";
import { AxiError } from "../errors.js";
import { takeFlag, getPositional } from "../args.js";
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
import type { ClickupContext } from "../context.js";

export const VIEW_HELP = `usage: clickup-axi view <subcommand> [flags]
subcommands[3]:
  list, get <id>, tasks <id>
flags{list}:
  --space <id>, --folder <id>, --list <id> (scope to a hierarchy node; --view-type <type> filter), --archived
flags{get}:
  (none)
flags{tasks}:
  --page <n>
examples:
  clickup-axi view list --space <id>
  clickup-axi view get <id>
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

const listSchema: FieldDef<ClickupView>[] = [field("id"), field("name"), field("type"), boolYesNo("archived")];
const viewSchema: FieldDef<ClickupView>[] = [field("id"), field("name"), field("type"), field("orderindex")];

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
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("View ID is required: clickup-axi view tasks <id>", "VALIDATION_ERROR");
  const page = takeFlag(args, "--page") ?? "0";
  const body = await get<{ tasks?: ClickupTaskSummary[] }>(`/view/${id}/task`, { page });
  const tasks = body?.tasks ?? [];
  return renderOutput([
    formatCountLine({ count: tasks.length }),
    renderList("tasks", tasks, taskSummarySchema),
    renderHelp(getSuggestions({ domain: "view", action: "tasks", id, ctx })),
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
    case "tasks":
      return viewTasks(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, get, tasks",
      ]);
  }
}
