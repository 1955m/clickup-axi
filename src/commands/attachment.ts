import { get } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag } from "../args.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
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

export const ATTACHMENT_HELP = `usage: clickup-axi attachment <subcommand> [flags]
subcommands[2]:
  list, upload
flags{list}:
  --task <id> (required)
flags{upload}:
  --task <id> (required), --file <path> (required), --dry-run | --execute
examples:
  clickup-axi attachment list --task <id>
  clickup-axi attachment upload --task <id> --file ./screenshot.png --execute`;

interface ClickupAttachment {
  id?: string;
  title?: string;
  filename?: string;
  url?: string;
  url_query?: string;
  date_created?: string | number;
}

const listSchema: FieldDef<ClickupAttachment>[] = [
  field("id"),
  field("title"),
  field("date_created"),
];

async function listAttachments(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--task"], "attachment list");
  const taskId = getFlag(args, "--task");
  if (!taskId)
    throw new AxiError(
      "--task <id> is required: clickup-axi attachment list --task <id>",
      "VALIDATION_ERROR",
    );
  const body = await get<{ attachments?: ClickupAttachment[] }>(`/task/${taskId}/attachments`);
  const attachments = body?.attachments ?? [];
  return renderOutput([
    formatCountLine({ count: attachments.length }),
    renderList("attachments", attachments, listSchema),
    renderHelp(getSuggestions({ domain: "attachment", action: "list", ctx })),
  ]);
}

async function uploadAttachment(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--task", "--file", "--execute", "--dry-run"], "attachment upload");
  const taskId = getFlag(args, "--task");
  if (!taskId) throw new AxiError("--task <id> is required", "VALIDATION_ERROR");
  const filePath = getFlag(args, "--file");
  if (!filePath) throw new AxiError("--file <path> is required", "VALIDATION_ERROR");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("upload", { task: taskId, file: filePath, status: writeGateLabel(gate) }, [
        field("task"),
        field("file"),
        field("status"),
      ]),
      renderHelp(["Add --execute to upload this file to ClickUp"]),
    ]);
  }
  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  // Upload via the public multipart endpoint. The ClickUp API attaches by
  // multipart form-data; we hand-build the body to avoid a form-data dep.
  const boundary = `----clickup-axi${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n${filename}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  // Use the raw request seam with a multipart content type override.
  const { request } = await import("../clickup.js");
  const resp = await request<{ id?: string; url?: string; title?: string }>({
    path: `/task/${taskId}/attachments`,
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
    noAuth: false,
  });
  return renderOutput([
    renderDetail(
      "uploaded",
      { id: resp.body?.id ?? null, url: resp.body?.url ?? null, status: "ok" },
      [field("id"), field("url"), field("status")],
    ),
    renderHelp(getSuggestions({ domain: "attachment", action: "upload", ctx })),
  ]);
}

export async function attachmentCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return ATTACHMENT_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listAttachments(rest, ctx);
    case "upload":
      return uploadAttachment(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, upload",
      ]);
  }
}
