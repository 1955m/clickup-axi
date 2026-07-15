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

export const FOLDER_HELP = `usage: clickup-axi folder <subcommand> [flags]
subcommands[5]:
  list, view <id>, create, update <id>, delete <id>
flags{list}:
  --space <id> (default: resolved ExampleSpace space), --archived
flags{create}:
  --name <text> (required)
flags{update}:
  --name
flags{create/update/delete}:
  --dry-run (default) | --execute
examples:
  clickup-axi folder list
  clickup-axi folder view <id>
  clickup-axi folder create --name "Sprint 14" --execute`;

interface ClickupFolder {
  id: string;
  name: string;
  hidden?: boolean;
  space?: { id?: string };
  lists?: ClickupListEntry[];
}

interface ClickupListEntry {
  id: string;
  name: string;
}

const listSchema: FieldDef<ClickupFolder>[] = [field("id"), field("name"), boolYesNo("hidden")];
const viewSchema: FieldDef<ClickupFolder>[] = [field("id"), field("name")];

async function listFolders(args: string[], ctx: ClickupContext): Promise<string> {
  const spaceId = takeFlag(args, "--space") ?? ctx.spaceId;
  const archived = hasFlag(args, "--archived") ? "true" : "false";
  const body = await get<{ folders?: ClickupFolder[] }>(
    `/space/${spaceId}/folder`,
    { archived },
  );
  const list = body?.folders ?? [];
  const isEmpty = list.length === 0;
  const suggestions = getSuggestions({ domain: "folder", action: "list", isEmpty, ctx });
  return renderOutput([
    formatCountLine({ count: list.length }),
    renderList("folders", list, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewFolder(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Folder ID is required: clickup-axi folder view <id>", "VALIDATION_ERROR");
  const folder = await get<ClickupFolder>(`/folder/${id}`);
  return renderOutput([
    renderDetail("folder", folder, viewSchema),
    renderHelp(getSuggestions({ domain: "folder", action: "view", id, ctx })),
  ]);
}

async function createFolder(args: string[], ctx: ClickupContext): Promise<string> {
  const spaceId = takeFlag(args, "--space") ?? ctx.spaceId;
  const name = takeFlag(args, "--name");
  if (!name) throw new AxiError("--name is required: clickup-axi folder create --name \"...\"", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { name, folder: "preview", status: writeGateLabel(gate) }, [
        field("name"),
        field("folder"),
        field("status"),
      ]),
      renderHelp(["Add --execute to create this folder in ClickUp"]),
    ]);
  }
  const created = await post<ClickupFolder>(`/space/${spaceId}/folder`, { name });
  return renderOutput([
    renderDetail("created", { id: created.id, name: created.name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "folder", action: "create", id: created.id, ctx })),
  ]);
}

async function updateFolder(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Folder ID is required: clickup-axi folder update <id>", "VALIDATION_ERROR");
  const name = takeFlag(args, "--name");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("update", { id, status: writeGateLabel(gate), payload: { name } }, [
        field("id"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to apply this update to ClickUp"]),
    ]);
  }
  await put(`/folder/${id}`, { name });
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "folder", action: "update", id, ctx })),
  ]);
}

async function deleteFolder(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Folder ID is required: clickup-axi folder delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this folder in ClickUp"]),
    ]);
  }
  await del(`/folder/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "folder", action: "delete", id, ctx })),
  ]);
}

export async function folderCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return FOLDER_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listFolders(rest, ctx);
    case "view":
      return viewFolder(rest, ctx);
    case "create":
      return createFolder(rest, ctx);
    case "update":
      return updateFolder(rest, ctx);
    case "delete":
      return deleteFolder(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, create, update, delete",
      ]);
  }
}
