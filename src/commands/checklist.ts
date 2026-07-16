import { get, post, put, del } from "../clickup.js";
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
import type { ClickupContext } from "../context.js";

export const CHECKLIST_HELP = `usage: clickup-axi checklist <subcommand> [flags]
subcommands[7]:
  list, create, update <id>, delete <id>, item-create, item-update <id>, item-delete <id>
flags{list}:
  --task <id> (required; read-only) — checklists are read from the task body (no dedicated GET endpoint)
flags{create}:
  --task <id> (required), --name <text> (required), --dry-run | --execute
flags{update}:
  --name <text>, --position <n>, --dry-run | --execute
flags{item-create}:
  --checklist <id> (required), --name <text> (required), --assign <user-id>, --dry-run | --execute
flags{item-update}:
  --name <text>, --resolved, --assign <user-id>, --dry-run | --execute
flags{delete/item-delete}:
  --dry-run | --execute
examples:
  clickup-axi checklist list --task <id>
  clickup-axi checklist create --task <id> --name "Launch checks" --execute
  clickup-axi checklist item-create --checklist <id> --name "Notify ops" --execute`;

interface ClickupChecklistItem {
  id?: string;
  name?: string;
  orderindex?: number;
  resolved?: boolean;
  assignee?: number | null;
}

interface ClickupChecklist {
  id: string;
  task_id?: string;
  name?: string;
  orderindex?: number;
  resolved?: number;
  unresolved?: number;
  items?: ClickupChecklistItem[];
}

const listSchema: FieldDef<ClickupChecklist>[] = [
  field("id"),
  field("name"),
  custom("items", (c) => `${c.resolved ?? 0}/${(c.resolved ?? 0) + (c.unresolved ?? 0)}`),
];
const itemSchema: FieldDef<ClickupChecklistItem>[] = [
  field("id"),
  field("name"),
  custom("resolved", (i) => (i.resolved ? "yes" : "no")),
  field("orderindex"),
];

async function listChecklists(args: string[], ctx: ClickupContext): Promise<string> {
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  // ClickUp exposes NO GET /task/<id>/checklist. Checklists are embedded in
  // the task object; read them from there (same pattern as dependencies).
  const task = await get<{ checklists?: ClickupChecklist[] }>(`/task/${taskId}`);
  const checklists = task?.checklists ?? [];
  const blocks: (string | undefined)[] = [
    formatCountLine({ count: checklists.length }),
    renderList("checklists", checklists, listSchema),
  ];
  const allItems = checklists.flatMap((c) => c.items ?? []);
  if (allItems.length > 0) blocks.push(renderList("checklist_items", allItems, itemSchema));
  blocks.push(renderHelp(getSuggestions({ domain: "checklist", action: "list", id: taskId, ctx })));
  return renderOutput(blocks);
}

async function createChecklist(args: string[], ctx: ClickupContext): Promise<string> {
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  if (!name) throw new AxiError("--name is required: clickup-axi checklist create --name \"...\"", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { name };
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { task: taskId, status: writeGateLabel(gate), payload }, [
        field("task"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this checklist in ClickUp"]),
    ]);
  }
  const created = await post<{ checklist?: ClickupChecklist }>(`/task/${taskId}/checklist`, payload);
  return renderOutput([
    renderDetail("created", { id: created.checklist?.id ?? null, name, task: taskId, status: "ok" }, [
      field("id"),
      field("name"),
      field("task"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "checklist", action: "create", id: taskId, ctx })),
  ]);
}

async function updateChecklist(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Checklist ID is required: clickup-axi checklist update <id>", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  const position = getFlag(args, "--position");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = {};
  if (name) payload["name"] = name;
  if (position !== undefined) payload["orderindex"] = Number(position);
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
  await put(`/checklist/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "checklist", action: "create", id, ctx })),
  ]);
}

async function deleteChecklist(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Checklist ID is required: clickup-axi checklist delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this checklist in ClickUp"]),
    ]);
  }
  await del(`/checklist/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "checklist", action: "create", id, ctx })),
  ]);
}

async function createItem(args: string[], ctx: ClickupContext): Promise<string> {
  const checklistId = getFlag(args, "--checklist");
  if (!checklistId) throw new AxiError("--checklist <id> is required", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  if (!name) throw new AxiError("--name is required", "VALIDATION_ERROR");
  const assign = getFlag(args, "--assign");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { name };
  if (assign) payload["assignee"] = Number(assign);
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { checklist: checklistId, status: writeGateLabel(gate), payload }, [
        field("checklist"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this checklist item in ClickUp"]),
    ]);
  }
  const created = await post<{ checklist_item?: ClickupChecklistItem }>(
    `/checklist/${checklistId}/checklist_item`,
    payload,
  );
  return renderOutput([
    renderDetail("created", { id: created.checklist_item?.id ?? null, name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "checklist", action: "create", id: checklistId, ctx })),
  ]);
}

async function updateItem(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Checklist item ID is required: clickup-axi checklist item-update <id>", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  const resolved = hasFlag(args, "--resolved");
  const assign = getFlag(args, "--assign");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = {};
  if (name) payload["name"] = name;
  if (resolved) payload["resolved"] = true;
  if (assign) payload["assignee"] = Number(assign);
  if (!gate.execute) {
    return renderOutput([
      renderDetail("item-update", { id, status: writeGateLabel(gate), payload }, [
        field("id"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to apply this update to ClickUp"]),
    ]);
  }
  // Item update path includes the checklist id; resolve it via the item id is
  // not possible from the path. ClickUp's edit-checklist-item endpoint is
  // /checklist/<checklist_id>/checklist_item/<item_id>, so require --checklist.
  const checklistId = getFlag(args, "--checklist");
  if (!checklistId) {
    throw new AxiError("--checklist <id> is required to scope the item update", "VALIDATION_ERROR");
  }
  await put(`/checklist/${checklistId}/checklist_item/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "checklist", action: "create", id, ctx })),
  ]);
}

async function deleteItem(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Checklist item ID is required: clickup-axi checklist item-delete <id>", "VALIDATION_ERROR");
  const checklistId = getFlag(args, "--checklist");
  if (!checklistId) {
    throw new AxiError("--checklist <id> is required to scope the item delete", "VALIDATION_ERROR");
  }
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("item-delete", { id, checklist: checklistId, status: writeGateLabel(gate) }, [
        field("id"),
        field("checklist"),
        field("status"),
      ]),
      renderHelp(["Add --execute to permanently delete this checklist item in ClickUp"]),
    ]);
  }
  await del(`/checklist/${checklistId}/checklist_item/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "checklist", action: "create", id, ctx })),
  ]);
}

export async function checklistCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return CHECKLIST_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listChecklists(rest, ctx);
    case "create":
      return createChecklist(rest, ctx);
    case "update":
      return updateChecklist(rest, ctx);
    case "delete":
      return deleteChecklist(rest, ctx);
    case "item-create":
      return createItem(rest, ctx);
    case "item-update":
      return updateItem(rest, ctx);
    case "item-delete":
      return deleteItem(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, create, update, delete, item-create, item-update, item-delete",
      ]);
  }
}
