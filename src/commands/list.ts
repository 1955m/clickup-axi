import { get, post, put, del } from "../clickup.js";
import { AxiError } from "../errors.js";
import { takeFlag, getPositional, hasFlag } from "../args.js";
import {
  field,
  boolYesNo,
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

export const LIST_HELP = `usage: clickup-axi list <subcommand> [flags]
subcommands[5]:
  list, view <id>, create, update <id>, delete <id>
flags{list}:
  --space <id> (default: resolved ExampleSpace space), --folder <id> (folder-scoped), --archived
flags{create}:
  --name <text> (required), --content <text> (optional description)
flags{update}:
  --name, --content
flags{create/update/delete}:
  --dry-run (default) | --execute
examples:
  clickup-axi list list
  clickup-axi list list --folder <folder-id>
  clickup-axi list view <id>
  clickup-axi list create --name "Backlog" --content "Sprint backlog" --execute`;

interface ClickupList {
  id: string;
  name: string;
  content?: string;
  archived?: boolean;
  space?: { id?: string };
  folder?: { id?: string; hidden?: boolean };
}

const listSchema: FieldDef<ClickupList>[] = [field("id"), field("name"), boolYesNo("archived")];
const viewSchema: FieldDef<ClickupList>[] = [field("id"), field("name"), field("content")];

async function listLists(args: string[], ctx: ClickupContext): Promise<string> {
  const folderId = takeFlag(args, "--folder") ?? ctx.folderId;
  const spaceId = takeFlag(args, "--space") ?? ctx.spaceId;
  const archived = hasFlag(args, "--archived") ? "true" : "false";
  let body: { lists?: ClickupList[] };
  if (folderId) {
    body = await get<{ lists?: ClickupList[] }>(`/folder/${folderId}/list`, { archived });
  } else {
    body = await get<{ lists?: ClickupList[] }>(`/space/${spaceId}/list`, { archived });
  }
  const list = body?.lists ?? [];
  const isEmpty = list.length === 0;
  const suggestions = getSuggestions({ domain: "list", action: "list", isEmpty, ctx });
  return renderOutput([
    formatCountLine({ count: list.length }),
    renderList("lists", list, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewList(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("List ID is required: clickup-axi list view <id>", "VALIDATION_ERROR");
  const list = await get<ClickupList>(`/list/${id}`);
  return renderOutput([
    renderDetail("list", list, viewSchema),
    renderHelp(getSuggestions({ domain: "list", action: "view", id, ctx })),
  ]);
}

async function createList(args: string[], ctx: ClickupContext): Promise<string> {
  const folderId = takeFlag(args, "--folder") ?? ctx.folderId;
  const spaceId = takeFlag(args, "--space") ?? ctx.spaceId;
  const name = takeFlag(args, "--name");
  if (!name) throw new AxiError("--name is required: clickup-axi list create --name \"...\"", "VALIDATION_ERROR");
  const content = takeFlag(args, "--content") ?? "";
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { name, list: "preview", status: writeGateLabel(gate) }, [
        field("name"),
        field("list"),
        field("status"),
      ]),
      renderHelp(["Add --execute to create this list in ClickUp"]),
    ]);
  }
  // Folder-scoped list POST lives under /folder/<id>/list; folderless lists POST under /space/<id>/list.
  const created = folderId
    ? await post<ClickupList>(`/folder/${folderId}/list`, { name, content })
    : await post<ClickupList>(`/space/${spaceId}/list`, { name, content });
  return renderOutput([
    renderDetail("created", { id: created.id, name: created.name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "list", action: "create", id: created.id, ctx })),
  ]);
}

async function updateList(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("List ID is required: clickup-axi list update <id>", "VALIDATION_ERROR");
  const name = takeFlag(args, "--name");
  const content = takeFlag(args, "--content");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = {};
  if (name) payload["name"] = name;
  if (content !== undefined) payload["content"] = content;
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
  await put(`/list/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "list", action: "update", id, ctx })),
  ]);
}

async function deleteList(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("List ID is required: clickup-axi list delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this list in ClickUp"]),
    ]);
  }
  await del(`/list/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "list", action: "delete", id, ctx })),
  ]);
}

export async function listCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return LIST_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listLists(rest, ctx);
    case "view":
      return viewList(rest, ctx);
    case "create":
      return createList(rest, ctx);
    case "update":
      return updateList(rest, ctx);
    case "delete":
      return deleteList(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, create, update, delete",
      ]);
  }
}
