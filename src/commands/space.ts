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

export const SPACE_HELP = `usage: clickup-axi space <subcommand> [flags]
subcommands[5]:
  list, view <id>, create, update <id>, delete <id>
flags{list}:
  --archived (include archived spaces)
flags{create}:
  --name <text> (required), --private (create a private space), --multiple (allow multiple assignees)
flags{update}:
  --name, --private, --multiple, --archived
flags{create/update/delete}:
  --dry-run (default) | --execute (required to mutate ClickUp)
examples:
  clickup-axi space list
  clickup-axi space view 200000000000
  clickup-axi space create --name "New Space" --execute`;

interface ClickupSpace {
  id: string;
  name: string;
  private?: boolean;
  archived?: boolean;
  statuses?: { status?: string; type?: string }[];
  features?: Record<string, unknown>;
}

const listSchema: FieldDef<ClickupSpace>[] = [field("id"), field("name"), boolYesNo("private")];
const viewSchema: FieldDef<ClickupSpace>[] = [
  field("id"),
  field("name"),
  boolYesNo("private"),
  boolYesNo("archived"),
];

async function listSpaces(args: string[], ctx: ClickupContext): Promise<string> {
  const archived = hasFlag(args, "--archived") ? "true" : "false";
  const body = await get<{ spaces?: ClickupSpace[] }>(
    `/team/${ctx.teamId}/space`,
    { archived },
  );
  const list = body?.spaces ?? [];
  const isEmpty = list.length === 0;
  const suggestions = getSuggestions({ domain: "space", action: "list", isEmpty, ctx });
  return renderOutput([
    formatCountLine({ count: list.length }),
    renderList("spaces", list, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewSpace(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0) ?? ctx.spaceId;
  if (!id) throw new AxiError("Space ID is required: clickup-axi space view <id>", "VALIDATION_ERROR");
  const space = await get<ClickupSpace>(`/space/${id}`);
  return renderOutput([
    renderDetail("space", space, viewSchema),
    renderHelp(getSuggestions({ domain: "space", action: "view", id, ctx })),
  ]);
}

async function createSpace(args: string[], ctx: ClickupContext): Promise<string> {
  const name = takeFlag(args, "--name");
  if (!name) throw new AxiError("--name is required: clickup-axi space create --name \"...\"", "VALIDATION_ERROR");
  const multiple = hasFlag(args, "--multiple");
  const privateSpace = hasFlag(args, "--private");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  // ClickUp v2 space create: { name, multiple_assignees, features }. Private
  // spaces are toggled post-create via the /space/<id> update (no create-time
  // private flag); we surface --private as a feature hint only.
  const payload: Record<string, unknown> = { name, multiple_assignees: multiple };
  if (privateSpace) payload["features"] = { due_dates: { enabled: true } };
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { name, space: "preview", status: writeGateLabel(gate), payload }, [
        field("name"),
        field("space"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this space in ClickUp"]),
    ]);
  }
  const created = await post<ClickupSpace>(`/team/${ctx.teamId}/space`, payload);
  return renderOutput([
    renderDetail("created", { id: created.id, name: created.name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "space", action: "create", id: created.id, ctx })),
  ]);
}

async function updateSpace(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0) ?? ctx.spaceId;
  if (!id) throw new AxiError("Space ID is required: clickup-axi space update <id>", "VALIDATION_ERROR");
  const name = takeFlag(args, "--name");
  const archived = hasFlag(args, "--archived");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = {};
  if (name) payload["name"] = name;
  if (archived) payload["archived"] = true;
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
  await put(`/space/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "space", action: "update", id, ctx })),
  ]);
}

async function deleteSpace(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Space ID is required: clickup-axi space delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this space in ClickUp"]),
    ]);
  }
  await del(`/space/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "space", action: "delete", id, ctx })),
  ]);
}

export async function spaceCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return SPACE_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listSpaces(rest, ctx);
    case "view":
      return viewSpace(rest, ctx);
    case "create":
      return createSpace(rest, ctx);
    case "update":
      return updateSpace(rest, ctx);
    case "delete":
      return deleteSpace(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, create, update, delete",
      ]);
  }
}
