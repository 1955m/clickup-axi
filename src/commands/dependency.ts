import { post, del } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag } from "../args.js";
import { field, renderDetail, renderHelp, renderOutput, renderError } from "../toon.js";
import { getSuggestions } from "../suggestions.js";
import { resolveWriteGate, writeGateLabel } from "../writeGuard.js";
import { rejectUnknownFlags, type ClickupContext } from "../context.js";

export const DEPENDENCY_HELP = `usage: clickup-axi dependency <subcommand> [flags]
subcommands[4]:
  add, delete, link, unlink
notes:
  add/delete model task DEPENDENCIES (waiting-on / blocking). link/unlink model task LINKS (the "Task Links" sidebar relation, not a dependency). The read view stays at \`task dependencies <id>\` (reads the task body — ClickUp has no GET /task/<id>/dependency, HTTP 405). All mutations default to --dry-run.
flags{add}:
  --task <id> (required), --depends-on <task-id> (waiting-on) | --dependency-of <task-id> (blocking) — exactly one required, --dry-run | --execute
flags{delete}:
  --task <id> (required), --depends-on <task-id> | --dependency-of <task-id> — exactly one required, --dry-run | --execute
flags{link}:
  --task <id> (required, the source task), --to <task-id> (required, the task to link to), --dry-run | --execute
flags{unlink}:
  --task <id> (required), --to <task-id> (required), --dry-run | --execute
examples:
  clickup-axi dependency add --task <id> --depends-on <other-task-id> --execute
  clickup-axi dependency link --task <id> --to <other-task-id> --execute`;

function resolveDepends(args: string[]): {
  field: "depends_on" | "dependency_of";
  value: string;
  label: string;
} {
  const dependsOn = getFlag(args, "--depends-on");
  const dependencyOf = getFlag(args, "--dependency-of");
  if (!dependsOn && !dependencyOf) {
    throw new AxiError(
      "--depends-on <task-id> (waiting-on) or --dependency-of <task-id> (blocking) is required",
      "VALIDATION_ERROR",
    );
  }
  if (dependsOn && dependencyOf) {
    throw new AxiError("Use only one of --depends-on or --dependency-of", "VALIDATION_ERROR");
  }
  return dependsOn
    ? { field: "depends_on", value: dependsOn, label: "depends-on" }
    : { field: "dependency_of", value: dependencyOf!, label: "dependency-of" };
}

async function addDependency(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--task", "--depends-on", "--dependency-of", "--execute", "--dry-run"],
    "dependency add",
  );
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const { field: depField, value, label } = resolveDepends(args);
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { [depField]: value };
  if (!gate.execute) {
    return renderOutput([
      renderDetail("dependency", { task: taskId, [label]: value, status: writeGateLabel(gate) }, [
        field("task"),
        field(label),
        field("status"),
      ]),
      renderHelp(["Add --execute to create this dependency in ClickUp"]),
    ]);
  }
  await post(`/task/${taskId}/dependency`, payload);
  return renderOutput([
    renderDetail("added", { task: taskId, [label]: value, status: "ok" }, [
      field("task"),
      field(label),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "task", action: "dependencies", id: taskId, ctx })),
  ]);
}

async function deleteDependency(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--task", "--depends-on", "--dependency-of", "--execute", "--dry-run"],
    "dependency delete",
  );
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const { field: depField, value, label } = resolveDepends(args);
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("dependency", { task: taskId, [label]: value, status: writeGateLabel(gate) }, [
        field("task"),
        field(label),
        field("status"),
      ]),
      renderHelp(["Add --execute to delete this dependency in ClickUp"]),
    ]);
  }
  await del(`/task/${taskId}/dependency`, { [depField]: value });
  return renderOutput([
    renderDetail("deleted", { task: taskId, [label]: value, status: "ok" }, [
      field("task"),
      field(label),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "task", action: "dependencies", id: taskId, ctx })),
  ]);
}

async function linkTask(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--task", "--to", "--execute", "--dry-run"], "dependency link");
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const linksTo = getFlag(args, "--to");
  if (!linksTo)
    throw new AxiError("--to <task-id> is required (the task to link to)", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("link", { task: taskId, to: linksTo, status: writeGateLabel(gate) }, [
        field("task"),
        field("to"),
        field("status"),
      ]),
      renderHelp(["Add --execute to link these tasks in ClickUp"]),
    ]);
  }
  await post(`/task/${taskId}/link/${linksTo}`, {});
  return renderOutput([
    renderDetail("linked", { task: taskId, to: linksTo, status: "ok" }, [
      field("task"),
      field("to"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "task", action: "dependencies", id: taskId, ctx })),
  ]);
}

async function unlinkTask(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--task", "--to", "--execute", "--dry-run"], "dependency unlink");
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const linksTo = getFlag(args, "--to");
  if (!linksTo) throw new AxiError("--to <task-id> is required", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("unlink", { task: taskId, to: linksTo, status: writeGateLabel(gate) }, [
        field("task"),
        field("to"),
        field("status"),
      ]),
      renderHelp(["Add --execute to unlink these tasks in ClickUp"]),
    ]);
  }
  await del(`/task/${taskId}/link/${linksTo}`);
  return renderOutput([
    renderDetail("unlinked", { task: taskId, to: linksTo, status: "ok" }, [
      field("task"),
      field("to"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "task", action: "dependencies", id: taskId, ctx })),
  ]);
}

export async function dependencyCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return DEPENDENCY_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "add":
      return addDependency(rest, ctx);
    case "delete":
      return deleteDependency(rest, ctx);
    case "link":
      return linkTask(rest, ctx);
    case "unlink":
      return unlinkTask(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: add, delete, link, unlink",
      ]);
  }
}
