import { get, post, put, del } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag } from "../args.js";
import {
  field,
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
import { rejectUnknownFlags, type ClickupContext } from "../context.js";

export const TAG_HELP = `usage: clickup-axi tag <subcommand> [flags]
subcommands[5]:
  list, create, update <tag-name>, delete <tag-name>, add-to-task, remove-from-task
flags{list}:
  --space <id> (default: resolved ExampleSpace space)
flags{create}:
  --tag <name> (required), --space <id>, --dry-run | --execute
flags{update}:
  --tag <name> (required), --new-name <name>, --dry-run | --execute
flags{delete}:
  --tag <name> (required), --space <id>, --dry-run | --execute
flags{add-to-task}:
  --task <id> (required), --tag <name> (required), --dry-run | --execute
flags{remove-from-task}:
  --task <id> (required), --tag <name> (required), --dry-run | --execute
examples:
  clickup-axi tag list
  clickup-axi tag create --tag "needs-review" --execute
  clickup-axi tag add-to-task --task <id> --tag "needs-review" --execute`;

interface ClickupTag {
  name: string;
  tag_id?: string;
  tag_fg?: string;
  tag_bg?: string;
}

const listSchema: FieldDef<ClickupTag>[] = [field("name"), field("tag_id")];

async function listTags(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--space"], "tag list");
  const spaceId = getFlag(args, "--space") ?? ctx.spaceId;
  const body = await get<{ tags?: ClickupTag[] }>(`/space/${spaceId}/tag`);
  const tags = body?.tags ?? [];
  return renderOutput([
    formatCountLine({ count: tags.length }),
    renderList("tags", tags, listSchema),
    renderHelp(getSuggestions({ domain: "tag", action: "list", ctx })),
  ]);
}

async function createTag(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--space", "--tag", "--execute", "--dry-run"], "tag create");
  const spaceId = getFlag(args, "--space") ?? ctx.spaceId;
  const tag = getFlag(args, "--tag");
  if (!tag) throw new AxiError("--tag <name> is required", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { tag, space: spaceId, status: writeGateLabel(gate) }, [
        field("tag"),
        field("space"),
        field("status"),
      ]),
      renderHelp(["Add --execute to create this tag in ClickUp"]),
    ]);
  }
  await post(`/space/${spaceId}/tag`, { tag });
  return renderOutput([
    renderDetail("created", { tag, status: "ok" }, [field("tag"), field("status")]),
    renderHelp(getSuggestions({ domain: "tag", action: "create", ctx })),
  ]);
}

async function updateTag(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--space", "--tag", "--new-name", "--execute", "--dry-run"],
    "tag update",
  );
  const spaceId = getFlag(args, "--space") ?? ctx.spaceId;
  const oldName = getFlag(args, "--tag");
  if (!oldName) throw new AxiError("--tag <name> is required", "VALIDATION_ERROR");
  const newName = getFlag(args, "--new-name");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("update", { tag: oldName, new_name: newName, status: writeGateLabel(gate) }, [
        field("tag"),
        field("new_name"),
        field("status"),
      ]),
      renderHelp(["Add --execute to rename this tag in ClickUp"]),
    ]);
  }
  await put(`/space/${spaceId}/tag/${oldName}`, { name: newName ?? oldName });
  return renderOutput([
    renderDetail("updated", { tag: oldName, new_name: newName, status: "ok" }, [
      field("tag"),
      field("new_name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "tag", action: "create", ctx })),
  ]);
}

async function deleteTag(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--space", "--tag", "--execute", "--dry-run"], "tag delete");
  const spaceId = getFlag(args, "--space") ?? ctx.spaceId;
  const tag = getFlag(args, "--tag");
  if (!tag) throw new AxiError("--tag <name> is required", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { tag, status: writeGateLabel(gate) }, [
        field("tag"),
        field("status"),
      ]),
      renderHelp(["Add --execute to permanently delete this tag in ClickUp"]),
    ]);
  }
  await del(`/space/${spaceId}/tag/${tag}`);
  return renderOutput([
    renderDetail("deleted", { tag, status: "ok" }, [field("tag"), field("status")]),
    renderHelp(getSuggestions({ domain: "tag", action: "create", ctx })),
  ]);
}

async function addToTask(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--task", "--tag", "--execute", "--dry-run"], "tag add-to-task");
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const tagName = getFlag(args, "--tag");
  if (!tagName) throw new AxiError("--tag <name> is required", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("tag", { task: taskId, tag: tagName, status: writeGateLabel(gate) }, [
        field("task"),
        field("tag"),
        field("status"),
      ]),
      renderHelp(["Add --execute to add this tag to the task in ClickUp"]),
    ]);
  }
  await post(`/task/${taskId}/tag/${tagName}`, {});
  return renderOutput([
    renderDetail("added", { task: taskId, tag: tagName, status: "ok" }, [
      field("task"),
      field("tag"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "tag", action: "create", ctx })),
  ]);
}

async function removeFromTask(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--task", "--tag", "--execute", "--dry-run"], "tag remove-from-task");
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const tagName = getFlag(args, "--tag");
  if (!tagName) throw new AxiError("--tag <name> is required", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("tag", { task: taskId, tag: tagName, status: writeGateLabel(gate) }, [
        field("task"),
        field("tag"),
        field("status"),
      ]),
      renderHelp(["Add --execute to remove this tag from the task in ClickUp"]),
    ]);
  }
  await del(`/task/${taskId}/tag/${tagName}`);
  return renderOutput([
    renderDetail("removed", { task: taskId, tag: tagName, status: "ok" }, [
      field("task"),
      field("tag"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "tag", action: "create", ctx })),
  ]);
}

export async function tagCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return TAG_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listTags(rest, ctx);
    case "create":
      return createTag(rest, ctx);
    case "update":
      return updateTag(rest, ctx);
    case "delete":
      return deleteTag(rest, ctx);
    case "add-to-task":
      return addToTask(rest, ctx);
    case "remove-from-task":
      return removeFromTask(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, create, update, delete, add-to-task, remove-from-task",
      ]);
  }
}
