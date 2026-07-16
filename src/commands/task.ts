import { get, post, put, del } from "../clickup.js";
import { AxiError } from "../errors.js";
import {
  getFlag,
  takeFlag,
  getAllFlags,
  hasFlag,
  getPositional,
} from "../args.js";
import { takeBody, truncateBody } from "../body.js";
import { parseFields } from "../fields.js";
import {
  field,
  pluck,
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
  buildFieldIndex,
  resolveFieldValue,
  requireFieldId,
  coerceFieldValue,
  type ClickupField,
  type FieldIndex,
} from "../customFields.js";
import type { ClickupContext } from "../context.js";

export const TASK_HELP = `usage: clickup-axi task <subcommand> [flags]
subcommands[12]:
  list, view <id>, create, update <id>, delete <id>, comments <id>, custom-fields <id>, dependencies <id>, time-in-status <id>, merge <id>, add-to-list <id>, remove-from-list <id>
flags{list}:
  --list <id> (default: first list in resolved space), --status <name>, --assignee <id>, --include-closed, --subtasks, --page <n>, --per-page <n> (default 30), --fields <a,b,c>, --search <text>
flags{view}:
  --comments, --full (show complete description)
flags{create}:
  --name <text> (required), --list <id>, --body <text> or --body-file <path>, --status <name>, --assignee <id> (repeatable), --priority <0-4>, --due <epoch-ms>, --set-field <NAME>=<value> (repeatable, resolves field by NAME), --dry-run | --execute
flags{update}:
  --name, --body, --status, --priority, --due, --set-field <NAME>=<value>, --dry-run | --execute
flags{delete}:
  --dry-run | --execute
flags{comments}:
  (read-only)
flags{custom-fields}:
  (read-only; resolves field values by type)
flags{dependencies}:
  (read-only)
flags{dependencies add}:
  --depends-on <task-id> (required), --type <waiting-on|blocking|task|subtask> (default waiting-on), --dry-run | --execute
flags{dependencies delete}:
  --depends-on <task-id> (required), --type <type>, --dry-run | --execute
flags{time-in-status}:
  (read-only; requires the Total Time in Status ClickApp enabled)
flags{merge}:
  --task <source-id> (repeatable, the tasks to merge INTO the target), --dry-run | --execute
flags{add-to-list}:
  --list <id> (required, the additional list), --dry-run | --execute
flags{remove-from-list}:
  --list <id> (required, the additional list; cannot remove the home list), --dry-run | --execute
examples:
  clickup-axi task list
  clickup-axi task list --status "in progress" --list <id>
  clickup-axi task view <id> --comments
  clickup-axi task create --name "Ship release" --list <id> --set-field "Product"=Backend --execute
  clickup-axi task time-in-status <id>
  clickup-axi task merge <target-id> --task <source-id> --execute
  clickup-axi task custom-fields <id>
  clickup-axi task dependencies <id>`;

interface ClickupStatus {
  status?: string;
  type?: string;
  orderindex?: string;
  color?: string;
}

interface ClickupUser {
  id?: number;
  username?: string;
  email?: string;
}

interface ClickupTask {
  id: string;
  name: string;
  status?: ClickupStatus;
  creator?: ClickupUser;
  assignees?: ClickupUser[];
  priority?: { priority?: string | number } | null;
  due_date?: string | number | null;
  date_created?: string | number;
  date_updated?: string | number;
  date_closed?: string | number | null;
  description?: string;
  list?: { id?: string };
  url?: string;
  custom_fields?: ClickupField[];
  tags?: { name?: string }[];
  time_spent?: number | null;
}

const listSchema: FieldDef<ClickupTask>[] = [
  field("id"),
  field("name"),
  custom("status", (t) => t.status?.status ?? "none"),
  pluck("creator", "username", "creator"),
  custom("assignees", (t) => (t.assignees?.map((a) => a.username ?? a.id).join(",") || "none")),
  custom("due", (t) => formatEpoch(t.due_date)),
  custom("created", (t) => formatEpoch(t.date_created)),
];

const TASK_LIST_EXTRA_FIELDS: Record<string, { jsonKey: string; def: FieldDef<ClickupTask> }> = {
  updated: { jsonKey: "date_updated", def: custom("updated", (t) => formatEpoch(t.date_updated)) },
  url: { jsonKey: "url", def: field("url") },
  priority: {
    jsonKey: "priority",
    def: custom("priority", (t) => (t.priority?.priority ?? "none")),
  },
  tags: {
    jsonKey: "tags",
    def: custom("tags", (t) => (t.tags?.map((x) => x.name).join(",") || "none")),
  },
  time_spent: {
    jsonKey: "time_spent",
    def: custom("time_spent", (t) => (t.time_spent ? `${t.time_spent}ms` : "none")),
  },
};

const viewSchema: FieldDef<ClickupTask>[] = [
  field("id"),
  field("name"),
  custom("status", (t) => `${t.status?.status ?? "none"} (${t.status?.type ?? "unknown"})`),
  pluck("creator", "username", "creator"),
  custom("assignees", (t) => (t.assignees?.map((a) => a.username ?? a.id).join(",") || "none")),
  custom("priority", (t) => (t.priority?.priority ?? "none")),
  custom("due", (t) => formatEpoch(t.due_date)),
  custom("created", (t) => formatEpoch(t.date_created)),
  custom("description", (t) => truncateBody(t.description, 500)),
];

const viewSchemaFull: FieldDef<ClickupTask>[] = viewSchema.map((f) =>
  f.as === "description"
    ? custom("description", (t) => (typeof t.description === "string" ? t.description : ""))
    : f,
);

const customFieldSchema: FieldDef<{ name: string; id?: string; value: unknown; field: ClickupField }>[] = [
  field("name"),
  field("id"),
  custom("value", (item) => resolveFieldValue(item.field)),
];

interface ClickupComment {
  id?: string;
  comment?: string;
  user?: ClickupUser;
  date?: string | number;
}

const commentSchema: FieldDef<ClickupComment>[] = [
  pluck("user", "username", "author"),
  custom("created", (c) => formatEpoch(c.date)),
  custom("body", (c) => truncateBody(c.comment, 800)),
];

function formatEpoch(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "none";
  const n = typeof value === "number" ? value : Number(value);
  if (!n || isNaN(n)) return "none";
  const then = new Date(n).getTime();
  if (isNaN(then)) return "none";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 0) return new Date(n).toISOString();
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(n).toISOString();
}

async function taskList(args: string[], ctx: ClickupContext): Promise<string> {
  const fieldsArg = takeFlag(args, "--fields");
  const { extraDefs } = parseFields(fieldsArg, TASK_LIST_EXTRA_FIELDS);
  const listId = takeFlag(args, "--list") ?? ctx.listId;
  const status = takeFlag(args, "--status");
  const assignee = takeFlag(args, "--assignee");
  const includeClosed = hasFlag(args, "--include-closed") ? "true" : "false";
  const subtasks = hasFlag(args, "--subtasks") ? "true" : "false";
  const page = takeFlag(args, "--page") ?? "0";
  const perPage = takeFlag(args, "--per-page") ?? "30";
  const search = takeFlag(args, "--search");

  if (!listId) {
    throw new AxiError(
      "A list ID is required: clickup-axi task list --list <id> (or run `clickup-axi list list` to find one)",
      "VALIDATION_ERROR",
      ["Add --list <id>, or pass --folder <id> to scope to a folder's lists"],
    );
  }

  const params: Record<string, string | number | boolean | undefined> = {
    page,
    order_by: "created",
    reverse: "true",
    subtasks,
    include_closed: includeClosed,
  };
  if (status) params["statuses[]"] = status;
  if (assignee) params["assignees[]"] = assignee;
  if (search) params["search"] = search;
  // ClickUp caps the page size; cap to 100.
  params["page_size"] = String(Math.min(Number(perPage) || 30, 100));

  const body = await get<{ tasks?: ClickupTask[]; last_page?: boolean }>(
    `/list/${listId}/task`,
    params,
  );
  const tasks = body?.tasks ?? [];
  const limitNum = Number(perPage);
  const apiLimitHit = body?.last_page === false && tasks.length >= limitNum;
  const extendedSchema = extraDefs.length > 0 ? [...listSchema, ...extraDefs] : listSchema;
  const suggestions = getSuggestions({
    domain: "task",
    action: "list",
    isEmpty: tasks.length === 0,
    ctx,
  });
  return renderOutput([
    formatCountLine({ count: tasks.length, limit: limitNum, apiLimitHit }),
    renderList("tasks", tasks, extendedSchema),
    renderHelp(suggestions),
  ]);
}

async function taskView(args: string[], ctx: ClickupContext): Promise<string> {
  const withComments = hasFlag(args, "--comments");
  const full = hasFlag(args, "--full");
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Task ID is required: clickup-axi task view <id>", "VALIDATION_ERROR");
  const task = await get<ClickupTask>(`/task/${id}`);
  const schema = full ? viewSchemaFull : viewSchema;
  const blocks: (string | undefined)[] = [renderDetail("task", task, schema)];
  if (withComments) {
    try {
      const cbody = await get<{ comments?: ClickupComment[] }>(`/task/${id}/comment`);
      const comments = cbody?.comments ?? [];
      if (comments.length > 0) blocks.push(renderList("comments", comments, commentSchema));
    } catch {
      // comments are best-effort
    }
  }
  blocks.push(renderHelp(getSuggestions({ domain: "task", action: "view", id, ctx })));
  return renderOutput(blocks);
}

/**
 * Resolve --set-field NAME=value pairs into the ClickUp custom_fields wire
 * format { field_id: coerced_value }, resolving field IDs by NAME at runtime
 * (never hardcoded UUIDs). Mirrors the reference mapping.py pattern.
 */
async function resolveSetFields(
  listId: string | undefined,
  setFields: string[],
): Promise<{ custom_fields: Record<string, unknown>; resolved: Array<{ name: string; value: string }> }> {
  const custom_fields: Record<string, unknown> = {};
  const resolved: Array<{ name: string; value: string }> = [];
  if (setFields.length === 0) return { custom_fields, resolved };
  if (!listId) {
    throw new AxiError(
      "--set-field needs a --list to resolve custom-field IDs by name",
      "VALIDATION_ERROR",
      ["Pass --list <id>, or set --folder to scope"],
    );
  }
  const index: FieldIndex = await fetchListFieldIndex(listId);
  for (const pair of setFields) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new AxiError(
        `Invalid --set-field value: ${pair}. Use --set-field "Field Name"=value`,
        "VALIDATION_ERROR",
      );
    }
    const name = pair.slice(0, eq).trim();
    const rawValue = pair.slice(eq + 1);
    const fieldDef = index.get(name.toLowerCase());
    const fieldId = requireFieldId(index, name);
    const coerced = coerceFieldValue(fieldDef, rawValue);
    custom_fields[fieldId] = coerced;
    resolved.push({ name, value: rawValue });
  }
  return { custom_fields, resolved };
}

async function taskCreate(args: string[], ctx: ClickupContext): Promise<string> {
  const name = getFlag(args, "--name");
  if (!name) throw new AxiError("--name is required", "VALIDATION_ERROR");
  const listId = getFlag(args, "--list") ?? ctx.listId;
  if (!listId) {
    throw new AxiError(
      "A list ID is required: --list <id> (or run `clickup-axi list list` to find one)",
      "VALIDATION_ERROR",
    );
  }
  const body = takeBody(args);
  const status = getFlag(args, "--status");
  const assignees = getAllFlags(args, "--assignee");
  const priority = getFlag(args, "--priority");
  const due = getFlag(args, "--due");
  const setFields = getAllFlags(args, "--set-field");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));

  const { custom_fields, resolved } = await resolveSetFields(listId, setFields);

  const payload: Record<string, unknown> = { name };
  if (body !== undefined) payload["description"] = body;
  if (status) payload["status"] = status;
  if (assignees.length > 0) payload["assignees"] = assignees.map((a) => Number(a));
  if (priority !== undefined) {
    const p = Number(priority);
    if (isNaN(p) || p < 0 || p > 4) {
      throw new AxiError(`Invalid --priority: ${priority}. Use 0-4 (4=urgent).`, "VALIDATION_ERROR");
    }
    payload["priority"] = p;
  }
  if (due !== undefined) payload["due_date"] = Number(due);
  if (Object.keys(custom_fields).length > 0) payload["custom_fields"] = custom_fields;

  if (!gate.execute) {
    return renderOutput([
      renderDetail(
        "create",
        {
          name,
          list: listId,
          status: writeGateLabel(gate),
          payload,
          set_fields: resolved,
        },
        [field("name"), field("list"), field("status"), field("payload"), field("set_fields")],
      ),
      renderHelp(["Add --execute to create this task in ClickUp"]),
    ]);
  }
  const created = await post<ClickupTask>(`/list/${listId}/task`, payload);
  return renderOutput([
    renderDetail("created", { id: created.id, name: created.name, status: "ok", url: created.url ?? null }, [
      field("id"),
      field("name"),
      field("status"),
      field("url"),
    ]),
    renderHelp(getSuggestions({ domain: "task", action: "create", id: created.id, ctx })),
  ]);
}

async function taskUpdate(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Task ID is required: clickup-axi task update <id>", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  const body = takeBody(args);
  const status = getFlag(args, "--status");
  const priority = getFlag(args, "--priority");
  const due = getFlag(args, "--due");
  const setFields = getAllFlags(args, "--set-field");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));

  const task = await get<ClickupTask>(`/task/${id}`);
  const listId = task.list?.id ?? ctx.listId;
  const { custom_fields, resolved } = await resolveSetFields(listId, setFields);

  const payload: Record<string, unknown> = {};
  if (name) payload["name"] = name;
  if (body !== undefined) payload["description"] = body;
  if (status) payload["status"] = status;
  if (priority !== undefined) {
    const p = Number(priority);
    if (isNaN(p) || p < 0 || p > 4) {
      throw new AxiError(`Invalid --priority: ${priority}. Use 0-4.`, "VALIDATION_ERROR");
    }
    payload["priority"] = p;
  }
  if (due !== undefined) payload["due_date"] = Number(due);
  if (Object.keys(custom_fields).length > 0) payload["custom_fields"] = custom_fields;

  if (!gate.execute) {
    return renderOutput([
      renderDetail("update", { id, status: writeGateLabel(gate), payload, set_fields: resolved }, [
        field("id"),
        field("status"),
        field("payload"),
        field("set_fields"),
      ]),
      renderHelp(["Add --execute to apply this update to ClickUp"]),
    ]);
  }
  await put(`/task/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "task", action: "update", id, ctx })),
  ]);
}

async function taskDelete(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Task ID is required: clickup-axi task delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this task in ClickUp"]),
    ]);
  }
  await del(`/task/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "task", action: "delete", id, ctx })),
  ]);
}

async function taskComments(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Task ID is required: clickup-axi task comments <id>", "VALIDATION_ERROR");
  const body = await get<{ comments?: ClickupComment[] }>(`/task/${id}/comment`);
  const comments = body?.comments ?? [];
  return renderOutput([
    formatCountLine({ count: comments.length }),
    renderList("comments", comments, commentSchema),
    renderHelp(getSuggestions({ domain: "task", action: "comments", id, ctx })),
  ]);
}

async function taskCustomFields(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Task ID is required: clickup-axi task custom-fields <id>", "VALIDATION_ERROR");
  const task = await get<{ custom_fields?: ClickupField[] }>(`/task/${id}`);
  const fields = task?.custom_fields ?? [];
  // Re-key by lowercased name so resolveFieldValue stays consistent with the
  // runtime index (buildFieldIndex pattern).
  const index = buildFieldIndex(fields);
  const rows = fields.map((f) => ({ name: f.name ?? "(unnamed)", id: f.id, value: undefined, field: index.get((f.name ?? "").toLowerCase()) ?? f }));
  return renderOutput([
    formatCountLine({ count: rows.length }),
    renderList("custom_fields", rows, customFieldSchema),
    renderHelp(getSuggestions({ domain: "task", action: "custom-fields", id, ctx })),
  ]);
}

interface ClickupDependency {
  task_id?: string;
  depends_on?: string;
  type?: string;
  order_id?: string;
}

const depSchema: FieldDef<ClickupDependency>[] = [
  field("task_id", "task"),
  field("depends_on"),
  field("type"),
];

async function taskDependencies(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Task ID is required: clickup-axi task dependencies <id>", "VALIDATION_ERROR");
  const rest = args.slice(1);
  const sub = rest[0];
  if (sub === "add" || sub === "delete") {
    return sub === "add" ? depAdd([id, ...rest.slice(1)], ctx) : depDelete([id, ...rest.slice(1)], ctx);
  }
  // ClickUp exposes NO GET /task/<id>/dependency (HTTP 405). Dependencies are
  // embedded in the task object as `dependencies` (tasks this one waits on)
  // and `linked_tasks` (reverse links). Read them from there.
  const task = await get<{ dependencies?: ClickupDependency[]; linked_tasks?: ClickupDependency[] }>(
    `/task/${id}`,
  );
  const deps = [...(task?.dependencies ?? []), ...(task?.linked_tasks ?? [])];
  return renderOutput([
    formatCountLine({ count: deps.length }),
    renderList("dependencies", deps, depSchema),
    renderHelp(getSuggestions({ domain: "task", action: "dependencies", id, ctx })),
  ]);
}

async function depAdd(args: string[], ctx: ClickupContext): Promise<string> {
  const id = args[0];
  const dependsOn = getFlag(args, "--depends-on");
  if (!dependsOn) throw new AxiError("--depends-on <task-id> is required", "VALIDATION_ERROR");
  const type = getFlag(args, "--type") ?? "waiting_on";
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("dependency", { task: id, depends_on: dependsOn, type, status: writeGateLabel(gate) }, [
        field("task"),
        field("depends_on"),
        field("type"),
        field("status"),
      ]),
      renderHelp(["Add --execute to create this dependency in ClickUp"]),
    ]);
  }
  await post(`/task/${id}/dependency`, {
    depends_on_task_id: dependsOn,
    type,
    depends_on: dependsOn,
  });
  return renderOutput([
    renderDetail("added", { task: id, depends_on: dependsOn, type, status: "ok" }, [
      field("task"),
      field("depends_on"),
      field("type"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "task", action: "dependencies", id, ctx })),
  ]);
}

async function depDelete(args: string[], ctx: ClickupContext): Promise<string> {
  const id = args[0];
  const dependsOn = getFlag(args, "--depends-on");
  if (!dependsOn) throw new AxiError("--depends-on <task-id> is required", "VALIDATION_ERROR");
  const type = getFlag(args, "--type") ?? "waiting_on";
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("dependency", { task: id, depends_on: dependsOn, type, status: writeGateLabel(gate) }, [
        field("task"),
        field("depends_on"),
        field("type"),
        field("status"),
      ]),
      renderHelp(["Add --execute to delete this dependency in ClickUp"]),
    ]);
  }
  await del(`/task/${id}/dependency`, { depends_on_task_id: dependsOn, type });
  return renderOutput([
    renderDetail("deleted", { task: id, depends_on: dependsOn, type, status: "ok" }, [
      field("task"),
      field("depends_on"),
      field("type"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "task", action: "dependencies", id, ctx })),
  ]);
}

export async function taskCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return taskList(rest, ctx);
    case "view":
      return taskView(rest, ctx);
    case "create":
      return taskCreate(rest, ctx);
    case "update":
      return taskUpdate(rest, ctx);
    case "delete":
      return taskDelete(rest, ctx);
    case "comments":
      return taskComments(rest, ctx);
    case "custom-fields":
      return taskCustomFields(rest, ctx);
    case "dependencies":
      return taskDependencies(rest, ctx);
    case "time-in-status":
      return taskTimeInStatus(rest, ctx);
    case "merge":
      return taskMerge(rest, ctx);
    case "add-to-list":
      return taskAddToList(rest, ctx);
    case "remove-from-list":
      return taskRemoveFromList(rest, ctx);
    case "--help":
    case "-h":
    case "help":
    case undefined:
      return TASK_HELP;
    default:
      return renderError(`Unknown task subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `clickup-axi task --help` to see available subcommands",
      ]);
  }
}

interface ClickupStatusDuration {
  status?: string;
  color?: string;
  total_time?: number;
  current_duration?: number;
}

async function taskTimeInStatus(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Task ID is required: clickup-axi task time-in-status <id>", "VALIDATION_ERROR");
  const body = await get<{ current_status?: ClickupStatusDuration; status_history?: ClickupStatusDuration[] }>(
    `/task/${id}/time_in_status`,
  );
  const cur = body?.current_status;
  const history = body?.status_history ?? [];
  const curRow = cur ? `${cur.status ?? "?"} (${formatDuration(cur.total_time)})` : "none";
  const historySchema: FieldDef<ClickupStatusDuration>[] = [
    field("status"),
    field("color"),
    custom("total", (s) => formatDuration(s.total_time)),
  ];
  return renderOutput([
    renderDetail("current_status", { status: curRow }, [field("status")]),
    formatCountLine({ count: history.length }),
    history.length ? renderList("status_history", history, historySchema) : undefined,
    renderHelp(getSuggestions({ domain: "task", action: "view", id, ctx })),
  ]);
}

function formatDuration(ms: number | undefined): string {
  if (!ms || isNaN(ms)) return "0s";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

async function taskMerge(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Target Task ID is required: clickup-axi task merge <id>", "VALIDATION_ERROR");
  const sourceTaskIds = getAllFlags(args, "--task");
  if (sourceTaskIds.length === 0) {
    throw new AxiError("--task <source-id> is required (repeatable; the tasks to merge INTO the target)", "VALIDATION_ERROR");
  }
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { source_task_ids: sourceTaskIds };
  if (!gate.execute) {
    return renderOutput([
      renderDetail("merge", { target: id, status: writeGateLabel(gate), payload }, [
        field("target"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to merge these tasks in ClickUp (the source tasks are deleted into the target)"]),
    ]);
  }
  await post(`/task/${id}/merge`, payload);
  return renderOutput([
    renderDetail("merged", { target: id, sources: sourceTaskIds.length, status: "ok" }, [
      field("target"),
      field("sources"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "task", action: "delete", id, ctx })),
  ]);
}

async function taskAddToList(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Task ID is required: clickup-axi task add-to-list <id>", "VALIDATION_ERROR");
  const listId = getFlag(args, "--list") ?? ctx.listId;
  if (!listId) throw new AxiError("--list <id> is required (the additional list)", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("add-to-list", { task: id, list: listId, status: writeGateLabel(gate) }, [
        field("task"),
        field("list"),
        field("status"),
      ]),
      renderHelp(["Add --execute to add this task to the additional list in ClickUp (requires Tasks in Multiple Lists ClickApp)"]),
    ]);
  }
  await post(`/list/${listId}/task/${id}`, {});
  return renderOutput([
    renderDetail("added", { task: id, list: listId, status: "ok" }, [field("task"), field("list"), field("status")]),
    renderHelp(getSuggestions({ domain: "task", action: "update", id, ctx })),
  ]);
}

async function taskRemoveFromList(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Task ID is required: clickup-axi task remove-from-list <id>", "VALIDATION_ERROR");
  const listId = getFlag(args, "--list") ?? ctx.listId;
  if (!listId) throw new AxiError("--list <id> is required (the additional list; cannot be the home list)", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("remove-from-list", { task: id, list: listId, status: writeGateLabel(gate) }, [
        field("task"),
        field("list"),
        field("status"),
      ]),
      renderHelp(["Add --execute to remove this task from the additional list in ClickUp (cannot remove the home list)"]),
    ]);
  }
  await del(`/list/${listId}/task/${id}`);
  return renderOutput([
    renderDetail("removed", { task: id, list: listId, status: "ok" }, [field("task"), field("list"), field("status")]),
    renderHelp(getSuggestions({ domain: "task", action: "update", id, ctx })),
  ]);
}
