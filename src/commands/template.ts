import { get, post } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag } from "../args.js";
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
import type { ClickupContext } from "../context.js";

export const TEMPLATE_HELP = `usage: clickup-axi template <subcommand> [flags]
subcommands[6]:
  task-list, list-list, folder-list, task-create, list-create, folder-create
notes:
  template IDs carry a "t-" prefix (e.g. t-15363293); pass the full ID including the prefix. Publicly shared templates must be added to your workspace library first. All create-* default to --dry-run.
flags{task-list/list-list/folder-list}:
  --team <id> (default: resolved EXAMPLE_ORG team), --page <n> (task-list only, default 0)
flags{task-create}:
  --list <id> (required, home list), --template <id> (required), --name <text> (required), --dry-run | --execute
flags{list-create}:
  --folder <id> | --space <id> (one required, location), --template <id> (required), --name <text> (required), --dry-run | --execute
flags{folder-create}:
  --space <id> (required), --template <id> (required), --name <text> (required), --dry-run | --execute
examples:
  clickup-axi template task-list
  clickup-axi template task-create --list <id> --template t-123 --name "New task" --execute
  clickup-axi template folder-create --space <id> --template t-456 --name "New folder" --execute`;

interface ClickupTemplateItem {
  id?: string;
  name?: string;
}

type TemplateRow = string | ClickupTemplateItem;

function templateId(row: TemplateRow): string | null {
  if (typeof row === "string") return row;
  return row.id ?? null;
}
function templateName(row: TemplateRow): string {
  if (typeof row === "string") return "";
  return row.name ?? "";
}

const listSchema: FieldDef<TemplateRow>[] = [
  custom("id", templateId),
  custom("name", templateName),
];

async function listTaskTemplates(args: string[], ctx: ClickupContext): Promise<string> {
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const page = getFlag(args, "--page") ?? "0";
  const body = await get<{ templates?: TemplateRow[] }>(`/team/${teamId}/taskTemplate`, { page });
  const templates = body?.templates ?? [];
  return renderOutput([
    formatCountLine({ count: templates.length }),
    renderList("templates", templates, listSchema),
    renderHelp(getSuggestions({ domain: "template", action: "list", ctx })),
  ]);
}

async function listListTemplates(args: string[], ctx: ClickupContext): Promise<string> {
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const body = await get<{ templates?: TemplateRow[] }>(`/team/${teamId}/list_template`);
  const templates = body?.templates ?? [];
  return renderOutput([
    formatCountLine({ count: templates.length }),
    renderList("templates", templates, listSchema),
    renderHelp(getSuggestions({ domain: "template", action: "list", ctx })),
  ]);
}

async function listFolderTemplates(args: string[], ctx: ClickupContext): Promise<string> {
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const body = await get<{ templates?: TemplateRow[] }>(`/team/${teamId}/folder_template`);
  const templates = body?.templates ?? [];
  return renderOutput([
    formatCountLine({ count: templates.length }),
    renderList("templates", templates, listSchema),
    renderHelp(getSuggestions({ domain: "template", action: "list", ctx })),
  ]);
}

function requireTemplateAndName(args: string[]): { templateId: string; name: string } {
  const templateId = getFlag(args, "--template");
  if (!templateId) throw new AxiError("--template <id> is required (IDs carry a 't-' prefix)", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  if (!name) throw new AxiError("--name is required", "VALIDATION_ERROR");
  return { templateId, name };
}

async function createTaskFromTemplate(args: string[], ctx: ClickupContext): Promise<string> {
  const listId = getFlag(args, "--list") ?? ctx.listId;
  if (!listId) throw new AxiError("--list <id> is required (the home list)", "VALIDATION_ERROR");
  const { templateId, name } = requireTemplateAndName(args);
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { name };
  if (!gate.execute) {
    return renderOutput([
      renderDetail("task-create", { list: listId, template: templateId, name, status: writeGateLabel(gate) }, [
        field("list"),
        field("template"),
        field("name"),
        field("status"),
      ]),
      renderHelp(["Add --execute to create this task from the template in ClickUp"]),
    ]);
  }
  const created = await post<{ id?: string }>(`/list/${listId}/taskTemplate/${templateId}`, payload);
  return renderOutput([
    renderDetail("created", { id: created.id ?? null, name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "template", action: "create", ctx })),
  ]);
}

async function createListFromTemplate(args: string[], ctx: ClickupContext): Promise<string> {
  const folderId = getFlag(args, "--folder") ?? ctx.folderId;
  const spaceId = getFlag(args, "--space") ?? ctx.spaceId;
  const { templateId, name } = requireTemplateAndName(args);
  if (!folderId && !spaceId) {
    throw new AxiError("--folder <id> or --space <id> is required (the location)", "VALIDATION_ERROR");
  }
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const path = folderId
    ? `/folder/${folderId}/list_template/${templateId}`
    : `/space/${spaceId}/list_template/${templateId}`;
  const payload: Record<string, unknown> = { name };
  if (!gate.execute) {
    return renderOutput([
      renderDetail("list-create", { location: folderId ?? spaceId, template: templateId, name, status: writeGateLabel(gate) }, [
        field("location"),
        field("template"),
        field("name"),
        field("status"),
      ]),
      renderHelp(["Add --execute to create this list from the template in ClickUp"]),
    ]);
  }
  const created = await post<{ id?: string }>(path, payload);
  return renderOutput([
    renderDetail("created", { id: created.id ?? null, name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "template", action: "create", ctx })),
  ]);
}

async function createFolderFromTemplate(args: string[], ctx: ClickupContext): Promise<string> {
  const spaceId = getFlag(args, "--space") ?? ctx.spaceId;
  const { templateId, name } = requireTemplateAndName(args);
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const path = `/space/${spaceId}/folder_template/${templateId}`;
  const payload: Record<string, unknown> = { name };
  if (!gate.execute) {
    return renderOutput([
      renderDetail("folder-create", { space: spaceId, template: templateId, name, status: writeGateLabel(gate) }, [
        field("space"),
        field("template"),
        field("name"),
        field("status"),
      ]),
      renderHelp(["Add --execute to create this folder from the template in ClickUp"]),
    ]);
  }
  const created = await post<{ id?: string }>(path, payload);
  return renderOutput([
    renderDetail("created", { id: created.id ?? null, name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "template", action: "create", ctx })),
  ]);
}

export async function templateCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return TEMPLATE_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "task-list":
      return listTaskTemplates(rest, ctx);
    case "list-list":
      return listListTemplates(rest, ctx);
    case "folder-list":
      return listFolderTemplates(rest, ctx);
    case "task-create":
      return createTaskFromTemplate(rest, ctx);
    case "list-create":
      return createListFromTemplate(rest, ctx);
    case "folder-create":
      return createFolderFromTemplate(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: task-list, list-list, folder-list, task-create, list-create, folder-create",
      ]);
  }
}
