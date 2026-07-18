import { get, post, put, del } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getFlag, getAllFlags, getPositional, hasFlag } from "../args.js";
import {
  field,
  custom,
  joinArray,
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

export const WEBHOOK_HELP = `usage: clickup-axi webhook <subcommand> [flags]
subcommands[4]:
  list, create, update <id>, delete <id>
flags{list}:
  --team <id> (default: resolved EXAMPLE_ORG team) — includes per-webhook health status
flags{create}:
  --endpoint <url> (required), --event <name> (repeatable, or --events a,b,c; use "*" for all), --space <id> | --folder <id> | --list <id> | --task <id> (scope), --dry-run | --execute
flags{update}:
  --endpoint <url>, --event <name> (repeatable; replaces events), --status <active|disable>, --dry-run | --execute
flags{delete}:
  --dry-run | --execute
examples:
  clickup-axi webhook list
  clickup-axi webhook create --endpoint https://hook.example.com/cu --event taskCreated --event taskUpdated --execute
  clickup-axi webhook create --endpoint <url> --event "*" --space <id> --execute`;

interface ClickupWebhookHealth {
  status?: string;
  timestamp?: string | number;
  count?: number;
}

interface ClickupWebhook {
  id: string;
  endpoint?: string;
  userid?: number;
  team_id?: string | number;
  events?: string[];
  status?: string;
  health?: ClickupWebhookHealth;
}

const listSchema: FieldDef<ClickupWebhook>[] = [
  field("id"),
  custom("endpoint", (w) => w.endpoint ?? "none"),
  joinArray("events", null, "events", "none"),
  custom("health", (w) => w.health?.status ?? "unknown"),
];

async function listWebhooks(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--team"], "webhook list");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const body = await get<{ webhooks?: ClickupWebhook[] }>(`/team/${teamId}/webhook`);
  const webhooks = body?.webhooks ?? [];
  return renderOutput([
    formatCountLine({ count: webhooks.length }),
    renderList("webhooks", webhooks, listSchema),
    renderHelp(getSuggestions({ domain: "webhook", action: "list", ctx })),
  ]);
}

async function createWebhook(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    [
      "--endpoint",
      "--event",
      "--events",
      "--space",
      "--folder",
      "--list",
      "--task",
      "--execute",
      "--dry-run",
    ],
    "webhook create",
  );
  const endpoint = getFlag(args, "--endpoint");
  if (!endpoint) throw new AxiError("--endpoint <url> is required", "VALIDATION_ERROR");
  const eventFlags = getAllFlags(args, "--event");
  const eventsCsv = getFlag(args, "--events");
  const events =
    eventFlags.length > 0
      ? eventFlags
      : eventsCsv
        ? eventsCsv
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean)
        : [];
  if (events.length === 0) {
    throw new AxiError(
      "--event <name> (repeatable) or --events a,b,c is required",
      "VALIDATION_ERROR",
    );
  }
  const spaceId = getFlag(args, "--space") ?? ctx.spaceId;
  const folderId = getFlag(args, "--folder") ?? ctx.folderId;
  const listId = getFlag(args, "--list") ?? ctx.listId;
  const taskId = getFlag(args, "--task");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { endpoint, events };
  if (listId) payload["list_id"] = Number(listId);
  else if (folderId) payload["folder_id"] = Number(folderId);
  else if (spaceId) payload["space_id"] = Number(spaceId);
  if (taskId) payload["task_id"] = taskId;
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { endpoint, status: writeGateLabel(gate), payload }, [
        field("endpoint"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this webhook in ClickUp"]),
    ]);
  }
  const created = await post<{ webhook?: ClickupWebhook }>(`/team/${ctx.teamId}/webhook`, payload);
  return renderOutput([
    renderDetail("created", { id: created.webhook?.id ?? null, endpoint, status: "ok" }, [
      field("id"),
      field("endpoint"),
      field("status"),
    ]),
    renderHelp(
      getSuggestions({ domain: "webhook", action: "create", id: created.webhook?.id, ctx }),
    ),
  ]);
}

async function updateWebhook(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--endpoint", "--event", "--events", "--status", "--execute", "--dry-run"],
    "webhook update",
  );
  const id = getPositional(args, 0);
  if (!id)
    throw new AxiError(
      "Webhook ID is required: clickup-axi webhook update <id>",
      "VALIDATION_ERROR",
    );
  const endpoint = getFlag(args, "--endpoint");
  const eventFlags = getAllFlags(args, "--event");
  const eventsCsv = getFlag(args, "--events");
  const status = getFlag(args, "--status");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const events =
    eventFlags.length > 0
      ? eventFlags
      : eventsCsv
        ? eventsCsv
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean)
        : [];
  const payload: Record<string, unknown> = {};
  if (endpoint) payload["endpoint"] = endpoint;
  if (events.length > 0) payload["events"] = events;
  if (status) payload["status"] = status;
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
  await put(`/webhook/${id}`, payload);
  return renderOutput([
    renderDetail("updated", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "webhook", action: "create", id, ctx })),
  ]);
}

async function deleteWebhook(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--execute", "--dry-run"], "webhook delete");
  const id = getPositional(args, 0);
  if (!id)
    throw new AxiError(
      "Webhook ID is required: clickup-axi webhook delete <id>",
      "VALIDATION_ERROR",
    );
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  if (!gate.execute) {
    return renderOutput([
      renderDetail("delete", { id, status: writeGateLabel(gate) }, [field("id"), field("status")]),
      renderHelp(["Add --execute to permanently delete this webhook in ClickUp"]),
    ]);
  }
  await del(`/webhook/${id}`);
  return renderOutput([
    renderDetail("deleted", { id, status: "ok" }, [field("id"), field("status")]),
    renderHelp(getSuggestions({ domain: "webhook", action: "create", id, ctx })),
  ]);
}

export async function webhookCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return WEBHOOK_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listWebhooks(rest, ctx);
    case "create":
      return createWebhook(rest, ctx);
    case "update":
      return updateWebhook(rest, ctx);
    case "delete":
      return deleteWebhook(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, create, update, delete",
      ]);
  }
}
