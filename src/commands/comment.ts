import { get, post, put, del } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getFlag, getPositional, hasFlag } from "../args.js";
import { takeBody, truncateBody } from "../body.js";
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
import type { ClickupContext } from "../context.js";

export const COMMENT_HELP = `usage: clickup-axi comment <subcommand> [flags]
subcommands[5]:
  list, view <id>, create, update <id>, delete <id>
flags{list}:
  --view <id> (list view comments) | --task <id> (list task comments) — one required
flags{create}:
  --task <id> (required) | --view <id>, --body <text> or --body-file <path> (required), --assign <user-id>, --resolved, --dry-run | --execute
flags{update}:
  --body <text> or --body-file <path>, --resolved, --dry-run | --execute
flags{delete}:
  --dry-run | --execute
examples:
  clickup-axi comment list --task <id>
  clickup-axi comment create --task <id> --body-file note.md --execute
  clickup-axi comment update <comment-id> --body "edited" --execute`;

interface ClickupComment {
  id?: string;
  comment?: string;
  comment_text?: string;
  user?: { username?: string; email?: string; id?: number };
  date?: string | number;
  resolved?: boolean;
}

const listSchema: FieldDef<ClickupComment>[] = [
  field("id"),
  pluck("user", "username", "author"),
  custom("created", (c) => formatEpoch(c.date)),
  custom("body", (c) => truncateBody(c.comment ?? c.comment_text, 800)),
  custom("resolved", (c) => (c.resolved ? "yes" : "no")),
];

async function listComments(args: string[], ctx: ClickupContext): Promise<string> {
  const taskId = getFlag(args, "--task");
  const viewId = getFlag(args, "--view");
  if (!taskId && !viewId) {
    throw new AxiError("Either --task <id> or --view <id> is required", "VALIDATION_ERROR");
  }
  const path = taskId ? `/task/${taskId}/comment` : `/view/${viewId}/comment`;
  const body = await get<{ comments?: ClickupComment[] }>(path);
  const comments = body?.comments ?? [];
  return renderOutput([
    formatCountLine({ count: comments.length }),
    renderList("comments", comments, listSchema),
    renderHelp(getSuggestions({ domain: "comment", action: "list", id: taskId ?? viewId, ctx })),
  ]);
}

async function viewComment(args: string[], _ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Comment ID is required: clickup-axi comment view <id>", "VALIDATION_ERROR");
  // ClickUp exposes comments under their container; re-fetch the task's comments
  // and find the one requested.
  const taskId = getFlag(args, "--task");
  const viewId = getFlag(args, "--view");
  if (!taskId && !viewId) {
    throw new AxiError("--task <id> or --view <id> is required to scope the comment lookup", "VALIDATION_ERROR");
  }
  const path = taskId ? `/task/${taskId}/comment` : `/view/${viewId}/comment`;
  const body = await get<{ comments?: ClickupComment[] }>(path);
  const comment = (body?.comments ?? []).find((c) => c.id === id);
  if (!comment) throw new AxiError(`Comment ${id} not found in this task/view`, "NOT_FOUND");
  return renderOutput([
    renderDetail("comment", comment, listSchema),
    renderHelp([]),
  ]);
}

async function createComment(args: string[], ctx: ClickupContext): Promise<string> {
  const taskId = getFlag(args, "--task");
  const viewId = getFlag(args, "--view");
  if (!taskId && !viewId) {
    throw new AxiError("Either --task <id> or --view <id> is required", "VALIDATION_ERROR");
  }
  const body = takeBody(args, { required: true });
  const assign = getFlag(args, "--assign");
  const resolved = hasFlag(args, "--resolved");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { comment_text: body, notify_all: false };
  if (assign) payload["assignee"] = Number(assign);
  if (resolved) payload["resolved"] = true;
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { status: writeGateLabel(gate), payload }, [field("status"), field("payload")]),
      renderHelp(["Add --execute to post this comment to ClickUp"]),
    ]);
  }
  const path = taskId ? `/task/${taskId}/comment` : `/view/${viewId}/comment`;
  const created = await post<ClickupComment>(path, payload);
  return renderOutput([
    renderDetail("created", { id: created.id ?? null, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "comment", action: "create", id: taskId ?? viewId, ctx })),
  ]);
}

async function updateComment(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Comment ID is required: clickup-axi comment update <id>", "VALIDATION_ERROR");
  const body = takeBody(args);
  const resolved = hasFlag(args, "--resolved");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = {};
  if (body !== undefined) payload["comment_text"] = body;
  if (resolved) payload["resolved"] = true;
  if (!gate.execute) {
    return renderOutput([
      renderDetail("update", { id, status: writeGateLabel(gate), payload }, [field("id"), field("status"), field("payload")]),
      renderHelp(["Add --execute to apply this update to ClickUp"]),
    ]);
  }
  await put(`/comment/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "comment", action: "update", id, ctx })),
  ]);
}

async function deleteComment(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Comment ID is required: clickup-axi comment delete <id>", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this comment in ClickUp"]),
    ]);
  }
  await del(`/comment/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "comment", action: "delete", id, ctx })),
  ]);
}

export async function commentCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return COMMENT_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listComments(rest, ctx);
    case "view":
      return viewComment(rest, ctx);
    case "create":
      return createComment(rest, ctx);
    case "update":
      return updateComment(rest, ctx);
    case "delete":
      return deleteComment(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, create, update, delete",
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
