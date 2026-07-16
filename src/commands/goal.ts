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

export const GOAL_HELP = `usage: clickup-axi goal <subcommand> [flags]
subcommands[8]:
  list, view <id>, create, update <id>, delete <id>, key-result-create, key-result-update <id>, key-result-delete <id>
flags{list}:
  --team <id> (default: resolved EXAMPLE_ORG team)
flags{create}:
  --name <text> (required), --team <id>, --description <text>, --due <epoch-ms>, --owners <id,id,...>, --color <hex>, --multiple-owners, --dry-run | --execute
flags{update}:
  --name, --description, --due, --owners, --color, --dry-run | --execute
flags{key-result-create}:
  --goal <id> (required), --name <text> (required), --target <n>, --current <n>, --type <number|currency|boolean|auto>, --unit <text>, --dry-run | --execute
flags{key-result-update}:
  --name, --current <n>, --target <n>, --dry-run | --execute
flags{delete/key-result-delete}:
  --dry-run | --execute
examples:
  clickup-axi goal list
  clickup-axi goal create --name "Q3 reliability" --due 1700000000000 --execute
  clickup-axi goal key-result-create --goal <id> --name "Uptime 99.9%" --target 99 --execute`;

interface ClickupKeyResult {
  id?: string;
  name?: string;
  type?: string;
  goal_id?: string;
  current?: number;
  target?: number;
  unit?: string;
  percent_completed?: number;
}

interface ClickupGoal {
  id: string;
  name?: string;
  team_id?: string;
  creator?: number;
  date_created?: string | number;
  due_date?: string | number;
  description?: string;
  color?: string;
  archived?: boolean;
  multiple_owners?: boolean;
  percent_completed?: number;
  owners?: { id?: number; username?: string }[];
  key_results?: ClickupKeyResult[];
}

const listSchema: FieldDef<ClickupGoal>[] = [
  field("id"),
  field("name"),
  custom("progress", (g) => `${g.percent_completed ?? 0}%`),
  custom("key_results", (g) => g.key_results?.length ?? 0),
  custom("due", (g) => formatEpoch(g.due_date)),
];
const viewSchema: FieldDef<ClickupGoal>[] = [
  field("id"),
  field("name"),
  custom("progress", (g) => `${g.percent_completed ?? 0}%`),
  custom("owners", (g) => g.owners?.map((o) => o.username ?? o.id).join(",") || "none"),
  custom("due", (g) => formatEpoch(g.due_date)),
  custom("created", (g) => formatEpoch(g.date_created)),
  field("description"),
];
const keyResultSchema: FieldDef<ClickupKeyResult>[] = [
  field("id"),
  field("name"),
  field("type"),
  custom("current", (k) => `${k.current ?? 0}/${k.target ?? 0} ${k.unit ?? ""}`.trim()),
  custom("progress", (k) => `${k.percent_completed ?? 0}%`),
];

async function listGoals(args: string[], ctx: ClickupContext): Promise<string> {
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const body = await get<{ goals?: ClickupGoal[] }>(`/team/${teamId}/goal`);
  const goals = body?.goals ?? [];
  return renderOutput([
    formatCountLine({ count: goals.length }),
    renderList("goals", goals, listSchema),
    renderHelp(getSuggestions({ domain: "goal", action: "list", ctx })),
  ]);
}

async function viewGoal(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Goal ID is required: clickup-axi goal view <id>", "VALIDATION_ERROR");
  const goal = await get<{ goal?: ClickupGoal }>(`/goal/${id}`);
  const g = goal?.goal;
  if (!g) return renderError(`Goal ${id} not found`, "NOT_FOUND");
  const blocks: (string | undefined)[] = [renderDetail("goal", g, viewSchema)];
  if (g.key_results?.length) blocks.push(renderList("key_results", g.key_results, keyResultSchema));
  blocks.push(renderHelp(getSuggestions({ domain: "goal", action: "view", id, ctx })));
  return renderOutput(blocks);
}

async function createGoal(args: string[], ctx: ClickupContext): Promise<string> {
  const name = getFlag(args, "--name");
  if (!name) throw new AxiError("--name is required: clickup-axi goal create --name \"...\"", "VALIDATION_ERROR");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const description = getFlag(args, "--description") ?? "";
  const due = getFlag(args, "--due");
  const owners = getFlag(args, "--owners");
  const color = getFlag(args, "--color");
  const multiple = hasFlag(args, "--multiple-owners");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { name, description, multiple_owners: multiple };
  if (due !== undefined) payload["due_date"] = Number(due);
  if (owners) payload["owners"] = owners.split(",").map((o) => Number(o.trim())).filter((n) => !isNaN(n));
  if (color) payload["color"] = color;
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { name, team: teamId, status: writeGateLabel(gate), payload }, [
        field("name"),
        field("team"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this goal in ClickUp"]),
    ]);
  }
  const created = await post<{ goal?: ClickupGoal }>(`/team/${teamId}/goal`, payload);
  return renderOutput([
    renderDetail("created", { id: created.goal?.id ?? null, name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "goal", action: "create", id: created.goal?.id, ctx })),
  ]);
}

async function updateGoal(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Goal ID is required: clickup-axi goal update <id>", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  const description = getFlag(args, "--description");
  const due = getFlag(args, "--due");
  const owners = getFlag(args, "--owners");
  const color = getFlag(args, "--color");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = {};
  if (name) payload["name"] = name;
  if (description !== undefined) payload["description"] = description;
  if (due !== undefined) payload["due_date"] = Number(due);
  if (owners) payload["owners"] = owners.split(",").map((o) => Number(o.trim())).filter((n) => !isNaN(n));
  if (color) payload["color"] = color;
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
  await put(`/goal/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "goal", action: "create", id, ctx })),
  ]);
}

async function deleteGoal(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Goal ID is required: clickup-axi goal delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this goal in ClickUp"]),
    ]);
  }
  await del(`/goal/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "goal", action: "create", id, ctx })),
  ]);
}

async function createKeyResult(args: string[], ctx: ClickupContext): Promise<string> {
  const goalId = getFlag(args, "--goal");
  if (!goalId) throw new AxiError("--goal <id> is required", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  if (!name) throw new AxiError("--name is required", "VALIDATION_ERROR");
  const target = getFlag(args, "--target");
  const current = getFlag(args, "--current");
  const type = getFlag(args, "--type") ?? "number";
  const unit = getFlag(args, "--unit");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { name, type };
  if (target !== undefined) payload["target"] = Number(target);
  if (current !== undefined) payload["current"] = Number(current);
  if (unit) payload["unit"] = unit;
  if (!gate.execute) {
    return renderOutput([
      renderDetail("key-result-create", { goal: goalId, status: writeGateLabel(gate), payload }, [
        field("goal"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this key result in ClickUp"]),
    ]);
  }
  const created = await post<{ key_result?: ClickupKeyResult }>(`/goal/${goalId}/key_result`, payload);
  return renderOutput([
    renderDetail("created", { id: created.key_result?.id ?? null, name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "goal", action: "create", id: goalId, ctx })),
  ]);
}

async function updateKeyResult(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Key result ID is required: clickup-axi goal key-result-update <id>", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  const target = getFlag(args, "--target");
  const current = getFlag(args, "--current");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = {};
  if (name) payload["name"] = name;
  if (target !== undefined) payload["target"] = Number(target);
  if (current !== undefined) payload["current"] = Number(current);
  if (!gate.execute) {
    return renderOutput([
      renderDetail("key-result-update", { id, status: writeGateLabel(gate), payload }, [
        field("id"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to apply this update to ClickUp"]),
    ]);
  }
  await put(`/key_result/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "goal", action: "create", id, ctx })),
  ]);
}

async function deleteKeyResult(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Key result ID is required: clickup-axi goal key-result-delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("key-result-delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this key result in ClickUp"]),
    ]);
  }
  await del(`/key_result/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "goal", action: "create", id, ctx })),
  ]);
}

export async function goalCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return GOAL_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listGoals(rest, ctx);
    case "view":
      return viewGoal(rest, ctx);
    case "create":
      return createGoal(rest, ctx);
    case "update":
      return updateGoal(rest, ctx);
    case "delete":
      return deleteGoal(rest, ctx);
    case "key-result-create":
      return createKeyResult(rest, ctx);
    case "key-result-update":
      return updateKeyResult(rest, ctx);
    case "key-result-delete":
      return deleteKeyResult(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, create, update, delete, key-result-create, key-result-update, key-result-delete",
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
