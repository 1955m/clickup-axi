import { getV3, postV3, putV3 } from "../clickup.js";
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
import { truncateBody, takeBody } from "../body.js";
import { getSuggestions } from "../suggestions.js";
import { resolveWriteGate, writeGateLabel } from "../writeGuard.js";
import { rejectUnknownFlags, type ClickupContext } from "../context.js";

export const DOC_HELP = `usage: clickup-axi doc <subcommand> [flags]
subcommands[7]:
  search, view <id>, create, page-list <id>, page-view <page-id>, page-create, page-edit <page-id>
notes:
  Docs are served by the ClickUp API v3 (ClickUp moved Docs out of v2). Paths are /api/v3/workspaces/<team>/docs. v3 search filters by parent/creator/archived/deleted — there is no free-text query param. page content is markdown (content_format text/md). create/page-create/page-edit default to --dry-run.
flags{search}:
  --team <id> (workspace, default EXAMPLE_ORG), --parent-id <id>, --parent-type <space|folder|list|everything|workspace>, --creator <user-id>, --archived, --deleted, --limit <n> (default 50, max 100), --cursor <cursor>
flags{view}:
  --team <id>
flags{create}:
  --name <text> (required), --team <id>, --parent-type <space|folder|list|everything|workspace>, --parent-id <id>, --visibility <public|private|personal|hidden>, --create-page, --dry-run | --execute
flags{page-list}:
  --team <id>, --depth <n> (max sub-page depth, default -1 = all)
flags{page-view}:
  --team <id>, --doc <id> (required, the doc that owns the page), --content-format <text/md|text/plain> (default text/md)
flags{page-create}:
  --doc <id> (required), --team <id>, --name <text> (required), --parent-page <id>, --sub-title <text>, --body <text> or --body-file <path>, --content-format <text/md|text/plain>, --dry-run | --execute
flags{page-edit}:
  --doc <id> (required), --team <id>, --name <text>, --sub-title <text>, --body <text> or --body-file <path>, --content-format <text/md|text/plain>, --dry-run | --execute
examples:
  clickup-axi doc search --parent-type space --parent-id <id>
  clickup-axi doc view <doc-id>
  clickup-axi doc page-view <page-id> --doc <doc-id>
  clickup-axi doc create --name "Runbook" --parent-type space --parent-id <id> --execute
  clickup-axi doc page-create --doc <doc-id> --name "Step 1" --body "Do the thing" --execute`;

const PARENT_TYPE_MAP: Record<string, number> = {
  space: 4,
  folder: 5,
  list: 6,
  everything: 7,
  workspace: 12,
};

interface ClickupDoc {
  id: string;
  name?: string;
  date_created?: string | number;
  date_updated?: string | number;
  creator?: number;
  parent?: { id?: string; type?: number };
  workspace_id?: number;
  archived?: boolean;
  deleted?: boolean;
}

interface ClickupPageRef {
  id?: string;
  name?: string;
  parent_page_id?: string;
  pages?: ClickupPageRef[];
}

interface ClickupPage {
  id?: string;
  name?: string;
  sub_title?: string;
  content?: string;
  date_created?: string | number;
  date_updated?: string | number;
}

const docSchema: FieldDef<ClickupDoc>[] = [
  field("id"),
  field("name"),
  custom("created", (d) => formatEpoch(d.date_created)),
  custom("updated", (d) => formatEpoch(d.date_updated)),
  custom("parent", (d) => (d.parent ? `${d.parent.id ?? "?"}/${d.parent.type ?? "?"}` : "none")),
];
const pageRefSchema: FieldDef<ClickupPageRef>[] = [
  field("id"),
  field("name"),
  field("parent_page_id"),
];

function v3DocPath(teamId: string, suffix = ""): string {
  return `/workspaces/${teamId}/docs${suffix}`;
}

async function searchDocs(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    [
      "--team",
      "--parent-id",
      "--parent-type",
      "--creator",
      "--limit",
      "--cursor",
      "--archived",
      "--deleted",
    ],
    "doc search",
  );
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const params: Record<string, string | number | boolean | undefined> = {};
  const parentId = getFlag(args, "--parent-id");
  const parentType = getFlag(args, "--parent-type");
  const creator = getFlag(args, "--creator");
  const limit = getFlag(args, "--limit") ?? "50";
  const cursor = getFlag(args, "--cursor");
  if (parentId) params["parent_id"] = parentId;
  if (parentType) {
    const mapped = PARENT_TYPE_MAP[parentType.toLowerCase()] ?? parentType;
    params["parent_type"] = String(mapped);
  }
  if (creator) params["creator"] = creator;
  if (hasFlag(args, "--archived")) params["archived"] = true;
  if (hasFlag(args, "--deleted")) params["deleted"] = true;
  params["limit"] = Math.min(Number(limit) || 50, 100);
  if (cursor) params["cursor"] = cursor;
  const body = await getV3<{ docs?: ClickupDoc[]; next_cursor?: string }>(
    v3DocPath(teamId),
    params,
  );
  const docs = body?.docs ?? [];
  const blocks: (string | undefined)[] = [
    formatCountLine({ count: docs.length }),
    renderList("docs", docs, docSchema),
  ];
  if (body?.next_cursor) {
    blocks.push(`next_cursor: ${body.next_cursor}`);
    blocks.push(renderHelp([`Pass --cursor ${body.next_cursor} to fetch the next page`]));
  }
  blocks.push(renderHelp(getSuggestions({ domain: "doc", action: "search", ctx })));
  return renderOutput(blocks);
}

async function viewDoc(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--team"], "doc view");
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Doc ID is required: clickup-axi doc view <id>", "VALIDATION_ERROR");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const doc = await getV3<ClickupDoc>(`${v3DocPath(teamId)}/${id}`);
  return renderOutput([
    renderDetail("doc", doc, docSchema),
    renderHelp(getSuggestions({ domain: "doc", action: "view", id, ctx })),
  ]);
}

async function createDoc(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    [
      "--name",
      "--team",
      "--parent-type",
      "--parent-id",
      "--visibility",
      "--create-page",
      "--execute",
      "--dry-run",
    ],
    "doc create",
  );
  const name = getFlag(args, "--name");
  if (!name)
    throw new AxiError(
      '--name is required: clickup-axi doc create --name "..."',
      "VALIDATION_ERROR",
    );
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const parentType = getFlag(args, "--parent-type");
  const parentId = getFlag(args, "--parent-id");
  const visibility = getFlag(args, "--visibility");
  const createPage = hasFlag(args, "--create-page");
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { name, create_page: createPage };
  if (visibility) payload["visibility"] = visibility.toUpperCase();
  if (parentType && parentId) {
    const mapped = PARENT_TYPE_MAP[parentType.toLowerCase()] ?? Number(parentType);
    payload["parent"] = { id: parentId, type: mapped };
  } else if (parentType || parentId) {
    throw new AxiError("--parent-type and --parent-id must be given together", "VALIDATION_ERROR");
  }
  if (!gate.execute) {
    return renderOutput([
      renderDetail("create", { name, team: teamId, status: writeGateLabel(gate), payload }, [
        field("name"),
        field("team"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this Doc in ClickUp (v3 Docs API)"]),
    ]);
  }
  const created = await postV3<ClickupDoc>(v3DocPath(teamId), payload);
  return renderOutput([
    renderDetail("created", { id: created.id ?? null, name: created.name ?? name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "doc", action: "create", id: created.id, ctx })),
  ]);
}

async function pageList(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--team", "--depth"], "doc page-list");
  const id = getPositional(args, 0);
  if (!id)
    throw new AxiError("Doc ID is required: clickup-axi doc page-list <id>", "VALIDATION_ERROR");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const depth = getFlag(args, "--depth") ?? "-1";
  const body = await getV3<ClickupPageRef[]>(`${v3DocPath(teamId)}/${id}/page_listing`, {
    max_page_depth: Number(depth),
  });
  const pages = Array.isArray(body) ? body : [];
  const flat: ClickupPageRef[] = [];
  const walk = (nodes: ClickupPageRef[]): void => {
    for (const n of nodes) {
      flat.push(n);
      if (n.pages?.length) walk(n.pages);
    }
  };
  walk(pages);
  return renderOutput([
    formatCountLine({ count: flat.length }),
    renderList("pages", flat, pageRefSchema),
    renderHelp(getSuggestions({ domain: "doc", action: "view", id, ctx })),
  ]);
}

async function pageView(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(args, ["--team", "--doc", "--content-format"], "doc page-view");
  const pageId = getPositional(args, 0);
  if (!pageId)
    throw new AxiError(
      "Page ID is required: clickup-axi doc page-view <page-id> --doc <id>",
      "VALIDATION_ERROR",
    );
  const docId = getFlag(args, "--doc");
  if (!docId)
    throw new AxiError("--doc <id> is required (the doc that owns the page)", "VALIDATION_ERROR");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const contentFormat = getFlag(args, "--content-format") ?? "text/md";
  const page = await getV3<ClickupPage>(`${v3DocPath(teamId)}/${docId}/pages/${pageId}`, {
    content_format: contentFormat,
  });
  const blocks: (string | undefined)[] = [
    renderDetail("page", { id: page.id, name: page.name, sub_title: page.sub_title }, [
      field("id"),
      field("name"),
      field("sub_title"),
    ]),
    renderDetail("content", { body: truncateBody(page.content ?? "", 2000) }, [field("body")]),
    renderHelp(getSuggestions({ domain: "doc", action: "view", id: pageId, ctx })),
  ];
  return renderOutput(blocks);
}

async function pageCreate(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    [
      "--doc",
      "--team",
      "--name",
      "--parent-page",
      "--sub-title",
      "--body",
      "--body-file",
      "--content-format",
      "--execute",
      "--dry-run",
    ],
    "doc page-create",
  );
  const docId = getFlag(args, "--doc");
  if (!docId) throw new AxiError("--doc <id> is required", "VALIDATION_ERROR");
  const name = getFlag(args, "--name");
  if (!name) throw new AxiError("--name is required", "VALIDATION_ERROR");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const parentPage = getFlag(args, "--parent-page");
  const subTitle = getFlag(args, "--sub-title");
  const bodyText = takeBody(args, { inlineFlags: ["--body"], fileFlags: ["--body-file"] });
  const contentFormat = getFlag(args, "--content-format") ?? "text/md";
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { name, content_format: contentFormat };
  if (parentPage) payload["parent_page_id"] = parentPage;
  if (subTitle) payload["sub_title"] = subTitle;
  if (bodyText !== undefined) payload["content"] = bodyText;
  if (!gate.execute) {
    return renderOutput([
      renderDetail("page-create", { doc: docId, status: writeGateLabel(gate), payload }, [
        field("doc"),
        field("status"),
        field("payload"),
      ]),
      renderHelp(["Add --execute to create this page in ClickUp (v3 Docs API)"]),
    ]);
  }
  const created = await postV3<ClickupPage>(`${v3DocPath(teamId)}/${docId}/pages`, payload);
  return renderOutput([
    renderDetail("created", { id: created.id ?? null, name, status: "ok" }, [
      field("id"),
      field("name"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "doc", action: "create", id: docId, ctx })),
  ]);
}

async function pageEdit(args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(
    args,
    [
      "--doc",
      "--team",
      "--name",
      "--sub-title",
      "--body",
      "--body-file",
      "--content-format",
      "--execute",
      "--dry-run",
    ],
    "doc page-edit",
  );
  const pageId = getPositional(args, 0);
  if (!pageId)
    throw new AxiError(
      "Page ID is required: clickup-axi doc page-edit <page-id> --doc <id>",
      "VALIDATION_ERROR",
    );
  const docId = getFlag(args, "--doc");
  if (!docId)
    throw new AxiError("--doc <id> is required (the doc that owns the page)", "VALIDATION_ERROR");
  const teamId = getFlag(args, "--team") ?? ctx.teamId;
  const name = getFlag(args, "--name");
  const subTitle = getFlag(args, "--sub-title");
  const bodyText = takeBody(args, { inlineFlags: ["--body"], fileFlags: ["--body-file"] });
  const contentFormat = getFlag(args, "--content-format") ?? "text/md";
  const gate = resolveWriteGate(hasFlag(args, "--execute"), hasFlag(args, "--dry-run"));
  const payload: Record<string, unknown> = { content_format: contentFormat };
  if (name) payload["name"] = name;
  if (subTitle) payload["sub_title"] = subTitle;
  if (bodyText !== undefined) {
    payload["content"] = bodyText;
    payload["content_edit_mode"] = "replace";
  }
  if (!gate.execute) {
    return renderOutput([
      renderDetail(
        "page-edit",
        { page: pageId, doc: docId, status: writeGateLabel(gate), payload },
        [field("page"), field("doc"), field("status"), field("payload")],
      ),
      renderHelp(["Add --execute to apply this page edit in ClickUp (v3 Docs API)"]),
    ]);
  }
  await putV3(`${v3DocPath(teamId)}/${docId}/pages/${pageId}`, payload);
  return renderOutput([
    renderDetail("updated", { page: pageId, status: "ok" }, [field("page"), field("status")]),
    renderHelp(getSuggestions({ domain: "doc", action: "create", id: pageId, ctx })),
  ]);
}

export async function docCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return DOC_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "search":
      return searchDocs(rest, ctx);
    case "view":
      return viewDoc(rest, ctx);
    case "create":
      return createDoc(rest, ctx);
    case "page-list":
      return pageList(rest, ctx);
    case "page-view":
      return pageView(rest, ctx);
    case "page-create":
      return pageCreate(rest, ctx);
    case "page-edit":
      return pageEdit(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: search, view, create, page-list, page-view, page-create, page-edit",
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
