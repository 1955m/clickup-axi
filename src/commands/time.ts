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

export const TIME_HELP = `usage: clickup-axi time <subcommand> [flags]
subcommands[6]:
  list, create, start, stop, get <id>, update <id>, delete <id>
flags{list}:
  --task <id>, --user <id>, --start <epoch-ms>, --end <epoch-ms>, --page <n>
flags{create}:
  --task <id> (required), --duration <ms> (or --hours <n>), --description <text>, --assign <user-id>, --start <epoch-ms>, --billable, --dry-run | --execute
flags{start}:
  --task <id> (required), --description <text>, --assign <user-id>, --dry-run | --execute
flags{stop}:
  --task <id> (required), --dry-run | --execute
flags{update}:
  --duration <ms>, --description <text>, --start <epoch-ms>, --billable, --dry-run | --execute
flags{delete}:
  --dry-run | --execute
examples:
  clickup-axi time list --task <id>
  clickup-axi time create --task <id> --hours 1.5 --description "Review" --execute
  clickup-axi time start --task <id> --execute`;

interface ClickupTimeEntry {
  id?: string;
  task?: { id?: string; name?: string };
  user?: { id?: number; username?: string };
  duration?: number;
  description?: string;
  start?: string | number;
  end?: string | number;
  billable?: boolean;
}

const listSchema: FieldDef<ClickupTimeEntry>[] = [
  field("id"),
  custom("task", (e) => e.task?.name ?? e.task?.id ?? "none"),
  custom("user", (e) => e.user?.username ?? e.user?.id ?? "none"),
  custom("duration", (e) => (e.duration ? `${e.duration}ms` : "none")),
  custom("start", (e) => formatEpoch(e.start)),
  field("description"),
];

async function listTime(args: string[], ctx: ClickupContext): Promise<string> {
  const taskId = getFlag(args, "--task");
  const userId = getFlag(args, "--user");
  const start = getFlag(args, "--start");
  const end = getFlag(args, "--end");
  const page = getFlag(args, "--page") ?? "0";
  if (!taskId && !userId) {
    throw new AxiError("--task <id> or --user <id> is required to scope time entries", "VALIDATION_ERROR");
  }
  const params: Record<string, string | undefined> = { page };
  if (taskId) params["task_id"] = taskId;
  if (userId) params["user_id"] = userId;
  if (start) params["start_date"] = start;
  if (end) params["end_date"] = end;
  const path = taskId ? `/task/${taskId}/time` : `/team/${ctx.teamId}/time_entries`;
  const body = await get<{ data?: ClickupTimeEntry[]; time_entries?: ClickupTimeEntry[] }>(path, params);
  const entries = body?.data ?? body?.time_entries ?? [];
  return renderOutput([
    formatCountLine({ count: entries.length }),
    renderList("time_entries", entries, listSchema),
    renderHelp(getSuggestions({ domain: "time", action: "list", ctx })),
  ]);
}

async function createTime(args: string[], ctx: ClickupContext): Promise<string> {
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const hours = getFlag(args, "--hours");
  const durationFlag = getFlag(args, "--duration");
  if (!hours && !durationFlag) {
    throw new AxiError("--duration <ms> or --hours <n> is required", "VALIDATION_ERROR");
  }
  const duration = hours ? Math.round(Number(hours) * 3600 * 1000) : Number(durationFlag);
  if (isNaN(duration) || duration <= 0) {
    throw new AxiError(`Invalid duration: ${hours ?? durationFlag}`, "VALIDATION_ERROR");
  }
  const description = getFlag(args, "--description") ?? "";
  const assign = getFlag(args, "--assign");
  const start = getFlag(args, "--start") ?? Date.now().toString();
  const billable = hasFlag(args, "--billable");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { duration, description, start: Number(start), billable };
  if (assign) payload["assignee"] = Number(assign);
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { task: taskId, status: writeGateLabel(gate), payload }, [
        field("task"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to log this time entry in ClickUp"]),
    ]);
  }
  const created = await post<ClickupTimeEntry>(`/task/${taskId}/time`, payload);
  return renderOutput([
    renderDetail("created", { id: created.id ?? null, task: taskId, status: "ok" }, [
      field("id"),
      field("task"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "time", action: "create", ctx })),
  ]);
}

async function startTime(args: string[], ctx: ClickupContext): Promise<string> {
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const description = getFlag(args, "--description") ?? "";
  const assign = getFlag(args, "--assign");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { description, billable: false };
  if (assign) payload["assignee"] = Number(assign);
  if (!gate.execute) {
    return renderOutput([
      renderDetail("start", { task: taskId, status: writeGateLabel(gate), payload }, [
        field("task"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to start this timer in ClickUp"]),
    ]);
  }
  const created = await post<ClickupTimeEntry>(`/team/${ctx.teamId}/time_tracking/start`, payload, { task_id: taskId });
  return renderOutput([
    renderDetail("started", { id: created.id ?? null, task: taskId, status: "ok" }, [
      field("id"),
      field("task"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "time", action: "create", ctx })),
  ]);
}

async function stopTime(args: string[], ctx: ClickupContext): Promise<string> {
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const gate = resolveWriteFlag(args);
  if (!gate.execute) {
    return renderOutput([
      renderDetail("stop", { task: taskId, status: writeGateLabel(gate) }, [field("task"), field("status")]),
      renderHelp(["Add --execute to stop this timer in ClickUp"]),
    ]);
  }
  await post(`/team/${ctx.teamId}/time_tracking/stop`, {}, { task_id: taskId });
  return renderOutput([
    renderDetail("stopped", { task: taskId, status: "ok" }, [field("task"), field("status")]),
    renderHelp(getSuggestions({ domain: "time", action: "create", ctx })),
  ]);
}

async function getTime(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Time entry ID is required: clickup-axi time get <id>", "VALIDATION_ERROR");
  const entry = await get<ClickupTimeEntry>(`/team/${ctx.teamId}/time_entries/entry/${id}`);
  return renderOutput([renderDetail("time_entry", entry, listSchema), renderHelp([])]);
}

async function updateTime(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Time entry ID is required: clickup-axi time update <id>", "VALIDATION_ERROR");
  const duration = getFlag(args, "--duration");
  const description = getFlag(args, "--description");
  const start = getFlag(args, "--start");
  const billable = hasFlag(args, "--billable");
  const gate = resolveWriteFlag(args);
  const payload: Record<string, unknown> = {};
  if (duration !== undefined) payload["duration"] = Number(duration);
  if (description !== undefined) payload["description"] = description;
  if (start !== undefined) payload["start"] = Number(start);
  if (billable) payload["billable"] = true;
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
  await put(`/team/${ctx.teamId}/time_entries/entry/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "time", action: "create", ctx })),
  ]);
}

async function deleteTime(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Time entry ID is required: clickup-axi time delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteFlag(args);
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this time entry in ClickUp"]),
    ]);
  }
  await del(`/team/${ctx.teamId}/time_entries/entry/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "time", action: "create", ctx })),
  ]);
}

function resolveWriteFlag(args: string[]) {
  return resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
}

export async function timeCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return TIME_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listTime(rest, ctx);
    case "create":
      return createTime(rest, ctx);
    case "start":
      return startTime(rest, ctx);
    case "stop":
      return stopTime(rest, ctx);
    case "get":
      return getTime(rest, ctx);
    case "update":
      return updateTime(rest, ctx);
    case "delete":
      return deleteTime(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, create, start, stop, get, update, delete",
      ]);
  }
}

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
