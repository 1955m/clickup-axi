import { getV3, postV3 } from "../clickup.js";
import { AxiError } from "../errors.js";
import { getFlag, getPositional, hasFlag } from "../args.js";
import { takeBody, truncateBody } from "../body.js";
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
import { rejectUnknownFlags, type ClickupContext } from "../context.js";

export const CHAT_HELP = `usage: clickup-axi chat <subcommand> [flags]
subcommands[5]:
  channel-list, channel-view <id>, channel-create, message-list <channel-id>, message-send
notes:
  ClickUp Chat is served by the API v3 and is EXPERIMENTAL ("subject to change at any time" per ClickUp). Paths are /api/v3/workspaces/<team>/chat. channel-create and message-send default to --dry-run and target the captain's COMPANY account — obtain explicit permission before --execute.
flags{channel-list}:
  --team <id> (default EXAMPLE_ORG), --limit <n> (default 50, max 100), --cursor <cursor>, --channel-types <channel,dm,group_dm>, --include-closed
flags{channel-view}:
  --team <id>
flags{channel-create}:
  --name <text> (required), --team <id>, --description <text>, --topic <text>, --user <id> (repeatable, up to 100), --visibility <public|private>, --dry-run | --execute
flags{message-list}:
  --team <id>, --limit <n> (default 50, max 100), --cursor <cursor>, --content-format <text/md|text/plain>
flags{message-send}:
  --channel <id> (required), --team <id>, --body <text> or --body-file <path> (required), --content-format <text/md|text/plain>, --type <post|...>, --dry-run | --execute
examples:
  clickup-axi chat channel-list
  clickup-axi chat channel-view <channel-id>
  clickup-axi chat message-list <channel-id>
  clickup-axi chat message-send --channel <id> --body "hello" --execute`;

interface ChatChannel {
  id?: string;
  name?: string;
  type?: string;
  visibility?: string;
  creator?: string;
  created_at?: string | number;
  archived?: boolean;
  parent?: { id?: string; type?: number };
}

interface ChatMessage {
  id?: string;
  content?: string | { content?: string[] };
  user_id?: string | number;
  date?: string | number;
  type?: string;
  resolved?: boolean;
}

const channelListSchema: FieldDef<ChatChannel>[] = [
  field("id"),
  field("name"),
  field("type"),
  field("visibility"),
  custom("created", (c) => formatEpoch(c.created_at)),
];
const channelViewSchema: FieldDef<ChatChannel>[] = [
  field("id"),
  field("name"),
  field("type"),
  field("visibility"),
  field("creator"),
  custom("parent", (c) => (c.parent ? `${c.parent.id ?? "?"}/${c.parent.type ?? "?"}` : "none")),
];
const messageSchema: FieldDef<ChatMessage>[] = [
  field("id"),
  custom("author", (m) => m.user_id ?? "unknown"),
  custom("created", (m) => formatEpoch(m.date)),
  custom("body", (m) => {
    const c = m.content;
    return truncateBody(
      typeof c === "string" ? c : Array.isArray(c?.content) ? c.content.join("\n") : "",
      800,
    );
  }),
];

function chatPath(teamId: string, suffix = ""): string {
  return `/workspaces/${teamId}/chat${suffix}`;
}

async function channelList(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--team", "--limit", "--cursor", "--channel-types", "--include-closed"],
    "chat channel-list",
  );
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const limit = getFlag(args, "--limit") ?? "50";
  const cursor = getFlag(args, "--cursor");
  const channelTypes = getFlag(args, "--channel-types");
  const params: Record<string, string | number | boolean | undefined> = {
    limit: Math.min(Number(limit) || 50, 100),
  };
  if (cursor) params["cursor"] = cursor;
  if (channelTypes) params["channel_types"] = channelTypes;
  if (hasFlag(args, "--include-closed")) params["include_closed"] = true;
  const body = await getV3<{ data?: ChatChannel[] }>(chatPath(teamId, "/channels"), params);
  const channels = body?.data ?? [];
  return renderOutput([
    formatCountLine({ count: channels.length }),
    renderList("channels", channels, channelListSchema),
    renderHelp(getSuggestions({ domain: "chat", action: "list", ctx })),
  ]);
}

async function channelView(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--team"], "chat channel-view");
  const id = getPositional(args, 0);
  if (!id)
    throw new AxiError(
      "Channel ID is required: clickup-axi chat channel-view <id>",
      "VALIDATION_ERROR",
    );
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const body = await getV3<{ data?: ChatChannel }>(`${chatPath(teamId, "/channels")}/${id}`);
  const channel = body?.data ?? {};
  return renderOutput([
    renderDetail("channel", channel, channelViewSchema),
    renderHelp(getSuggestions({ domain: "chat", action: "view", id, ctx })),
  ]);
}

async function channelCreate(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    [
      "--name",
      "--team",
      "--description",
      "--topic",
      "--user",
      "--visibility",
      "--execute",
      "--dry-run",
    ],
    "chat channel-create",
  );
  const name = getFlag(args, "--name");
  if (!name)
    throw new AxiError(
      '--name is required: clickup-axi chat channel-create --name "..."',
      "VALIDATION_ERROR",
    );
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const description = getFlag(args, "--description");
  const topic = getFlag(args, "--topic");
  const users = collectRepeatable(args, "--user");
  const visibility = getFlag(args, "--visibility");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { name };
  if (description) payload["description"] = description;
  if (topic) payload["topic"] = topic;
  if (users.length > 0) payload["user_ids"] = users;
  if (visibility) payload["visibility"] = visibility.toUpperCase();
  if (!gate.execute) {
    return renderOutput([
      renderDetail(
        "channel-create",
        { name, team: teamId, status: writeGateLabel(gate), payload },
        [field("name"), field("team"), field("status"), field("payload")],
      ),
      renderHelp(["Add --execute to create this Chat channel in ClickUp (v3 experimental)"]),
    ]);
  }
  const created = await postV3<{ data?: ChatChannel }>(chatPath(teamId, "/channels"), payload);
  return renderOutput([
    renderDetail("created", { id: created.data?.id ?? null, name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "chat", action: "create", id: created.data?.id, ctx })),
  ]);
}

async function messageList(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    ["--team", "--limit", "--cursor", "--content-format"],
    "chat message-list",
  );
  const channelId = getPositional(args, 0);
  if (!channelId)
    throw new AxiError(
      "Channel ID is required: clickup-axi chat message-list <channel-id>",
      "VALIDATION_ERROR",
    );
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const limit = getFlag(args, "--limit") ?? "50";
  const cursor = getFlag(args, "--cursor");
  const contentFormat = getFlag(args, "--content-format") ?? "text/md";
  const params: Record<string, string | number | undefined> = {
    limit: Math.min(Number(limit) || 50, 100),
    content_format: contentFormat,
  };
  if (cursor) params["cursor"] = cursor;
  const body = await getV3<{ data?: ChatMessage[] }>(
    `${chatPath(teamId, "/channels")}/${channelId}/messages`,
    params,
  );
  const messages = body?.data ?? [];
  return renderOutput([
    formatCountLine({ count: messages.length }),
    renderList("messages", messages, messageSchema),
    renderHelp(getSuggestions({ domain: "chat", action: "list", id: channelId, ctx })),
  ]);
}

async function messageSend(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    [
      "--channel",
      "--team",
      "--body",
      "--body-file",
      "--content-format",
      "--type",
      "--execute",
      "--dry-run",
    ],
    "chat message-send",
  );
  const channelId = getFlag(args, "--channel");
  if (!channelId) throw new AxiError("--channel <id> is required", "VALIDATION_ERROR");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const body = takeBody(args, { required: true });
  const contentFormat = getFlag(args, "--content-format") ?? "text/md";
  const type = getFlag(args, "--type");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { content: body, content_format: contentFormat };
  if (type) payload["type"] = type;
  if (!gate.execute) {
    return renderOutput([
      renderDetail("message-send", { channel: channelId, status: writeGateLabel(gate), payload }, [
        field("channel"),
        field("status"),
        field("payload"),
      ]),
      renderHelp([
        "Add --execute to send this Chat message in ClickUp (v3 experimental; COMPANY account)",
      ]),
    ]);
  }
  const created = await postV3<{ data?: ChatMessage }>(
    `${chatPath(teamId, "/channels")}/${channelId}/messages`,
    payload,
  );
  return renderOutput([
    renderDetail("sent", { id: created.data?.id ?? null, status: "ok" }, [
      field("id"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "chat", action: "create", id: channelId, ctx })),
  ]);
}

function collectRepeatable(args: string[], flag: string): string[] {
  const out: string[] = [];
  const equalsPrefix = `${flag}=`;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === flag && i + 1 < args.length) {
      out.push(args[i + 1]);
      i++;
    } else if (a.startsWith(equalsPrefix)) {
      out.push(a.slice(equalsPrefix.length));
    }
  }
  return out;
}

export async function chatCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return CHAT_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "channel-list":
      return channelList(rest, ctx);
    case "channel-view":
      return channelView(rest, ctx);
    case "channel-create":
      return channelCreate(rest, ctx);
    case "message-list":
      return messageList(rest, ctx);
    case "message-send":
      return messageSend(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: channel-list, channel-view, channel-create, message-list, message-send",
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
