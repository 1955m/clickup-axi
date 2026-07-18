import { get } from "../clickup.js";
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
import {
  fetchListFieldIndex,
  fetchFolderFieldIndex,
  fetchSpaceFieldIndex,
  fetchTeamFieldIndex,
  resolveFieldValue,
  requireFieldId,
  coerceFieldValue,
  type ClickupField,
  type FieldIndex,
} from "../customFields.js";
import { post, del } from "../clickup.js";
import { rejectUnknownFlags, type ClickupContext } from "../context.js";

export const CUSTOM_FIELD_HELP = `usage: clickup-axi custom-field <subcommand> [flags]
subcommands[3]:
  list, set <task-id>, remove <task-id>
notes:
  list shows the Custom Fields accessible at a scope (workspace fields are included when querying a list/folder/space). set/remove resolve the field UUID by NAME at runtime (never hardcode UUIDs). All set/remove default to --dry-run; even dry-run does one read-only GET /list/<id>/field to resolve the UUID by name.
flags{list}:
  --list <id> | --folder <id> | --space <id> | --team <id> (exactly one scope; default --team)
flags{set}:
  <task-id> (positional), --field <NAME>=<value> (repeatable, resolves by NAME), --list <id> (optional; resolved from the task's home list when omitted), --dry-run | --execute
flags{remove}:
  <task-id> (positional), --name <NAME> (required), --list <id> (optional), --dry-run | --execute
examples:
  clickup-axi custom-field list --list <id>
  clickup-axi custom-field list --space <id>
  clickup-axi custom-field set <task-id> --field "Product"=Backend --execute
  clickup-axi custom-field remove <task-id> --name "Risk" --execute`;

interface ClickupTaskRef {
  list?: { id?: string };
}

const fieldSchema: FieldDef<ClickupField>[] = [
  field("id"),
  field("name"),
  field("type"),
  custom("value", (f) => resolveFieldValue(f)),
];

function resolveScope(
  args: string[],
  ctx: ClickupContext,
): { index: Promise<FieldIndex>; label: string } {
  const listId = getFlag(args, "--list") ?? ctx.listId;
  const folderId = getFlag(args, "--folder") ?? ctx.folderId;
  const spaceId = getFlag(args, "--space") ?? ctx.spaceId;
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  if (listId) return { index: fetchListFieldIndex(listId), label: "list" };
  if (folderId) return { index: fetchFolderFieldIndex(folderId), label: "folder" };
  if (spaceId) return { index: fetchSpaceFieldIndex(spaceId), label: "space" };
  return { index: fetchTeamFieldIndex(teamId), label: "team" };
}

async function listFields(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--list", "--folder", "--space", "--team"], "custom-field list");
  const { index } = resolveScope(args, ctx);
  const idx = await index;
  const fields = [...idx.values()];
  return renderOutput([
    formatCountLine({ count: fields.length }),
    renderList("custom_fields", fields, fieldSchema),
    renderHelp(getSuggestions({ domain: "custom-field", action: "list", ctx })),
  ]);
}

async function resolveTaskListId(taskId: string): Promise<string | undefined> {
  const task = await get<ClickupTaskRef>(`/task/${taskId}`);
  return task?.list?.id;
}

async function setField(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--field", "-F", "--list", "--execute", "--dry-run"],
    "custom-field set",
  );
  const taskId = getPositional(args, 0);
  if (!taskId)
    throw new AxiError(
      "Task ID is required: clickup-axi custom-field set <task-id>",
      "VALIDATION_ERROR",
    );
  const pairs = ((): string[] => {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--field" || a === "-F") {
        const v = args[i + 1];
        if (v) out.push(v);
        i++;
      } else if (a.startsWith("--field=")) {
        out.push(a.slice("--field=".length));
      } else if (a.startsWith("-F=")) {
        out.push(a.slice("-F=".length));
      }
    }
    return out;
  })();
  if (pairs.length === 0) {
    throw new AxiError(
      '--field "NAME"=value is required (repeatable; resolves field UUID by NAME)',
      "VALIDATION_ERROR",
    );
  }
  const listId = getFlag(args, "--list") ?? (await resolveTaskListId(taskId)) ?? ctx.listId;
  if (!listId) {
    throw new AxiError(
      "--list <id> is required to resolve custom-field UUIDs by name (or the task must have a home list)",
      "VALIDATION_ERROR",
    );
  }
  const index = await fetchListFieldIndex(listId);
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const custom_fields: Record<string, unknown> = {};
  const resolved: Array<{ name: string; value: string; field_id: string }> = [];
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new AxiError(
        `Invalid --field value: ${pair}. Use --field "Field Name"=value`,
        "VALIDATION_ERROR",
      );
    }
    const name = pair.slice(0, eq).trim();
    const rawValue = pair.slice(eq + 1);
    const fieldDef = index.get(name.toLowerCase());
    const fieldId = requireFieldId(index, name);
    const coerced = coerceFieldValue(fieldDef, rawValue);
    custom_fields[fieldId] = coerced;
    resolved.push({ name, value: rawValue, field_id: fieldId });
  }
  if (!gate.execute) {
    return renderOutput([
      renderDetail(
        "set",
        { task: taskId, status: writeGateLabel(gate), custom_fields, set_fields: resolved },
        [field("task"), field("status"), field("custom_fields"), field("set_fields")],
      ),
      renderHelp(["Add --execute to set this custom-field value in ClickUp"]),
    ]);
  }
  for (const { field_id } of resolved) {
    await post(`/task/${taskId}/field/${field_id}`, { value: custom_fields[field_id] });
  }
  return renderOutput([
    renderDetail("set", { task: taskId, count: resolved.length, status: "ok" }, [
      field("task"),
      field("count"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "custom-field", action: "set", id: taskId, ctx })),
  ]);
}

async function removeField(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--name", "--list", "--execute", "--dry-run"], "custom-field remove");
  const taskId = getPositional(args, 0);
  if (!taskId)
    throw new AxiError(
      "Task ID is required: clickup-axi custom-field remove <task-id>",
      "VALIDATION_ERROR",
    );
  const name = getFlag(args, "--name");
  if (!name)
    throw new AxiError(
      "--name <NAME> is required (resolves field UUID by NAME)",
      "VALIDATION_ERROR",
    );
  const listId = getFlag(args, "--list") ?? (await resolveTaskListId(taskId)) ?? ctx.listId;
  if (!listId) {
    throw new AxiError(
      "--list <id> is required to resolve the custom-field UUID by name",
      "VALIDATION_ERROR",
    );
  }
  const index = await fetchListFieldIndex(listId);
  const fieldId = requireFieldId(index, name);
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail(
        "remove",
        { task: taskId, name, field_id: fieldId, status: writeGateLabel(gate) },
        [field("task"), field("name"), field("field_id"), field("status")],
      ),
      renderHelp(["Add --execute to remove this custom-field value in ClickUp"]),
    ]);
  }
  await del(`/task/${taskId}/field/${fieldId}`);
  return renderOutput([
    renderDetail("removed", { task: taskId, name, status: "ok" }, [
      field("task"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "custom-field", action: "set", id: taskId, ctx })),
  ]);
}

export async function customFieldCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return CUSTOM_FIELD_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listFields(rest, ctx);
    case "set":
      return setField(rest, ctx);
    case "remove":
      return removeField(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, set, remove",
      ]);
  }
}
