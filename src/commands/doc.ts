import { get } from "../clickup.js";
import { AxiError } from "../errors.js";
import { takeFlag, getPositional } from "../args.js";
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
import { truncateBody } from "../body.js";
import { getSuggestions } from "../suggestions.js";
import type { ClickupContext } from "../context.js";

export const DOC_HELP = `usage: clickup-axi doc <subcommand> [flags]
subcommands[4]:
  search, view <id>, page-list <id>, page-view <page-id>
flags{search}:
  --query <text> (required), --team <id>, --folder <id>, --list <id>, --space <id>
flags{view}:
  (none — returns the doc's pages and source)
flags{page-list}:
  (none — lists pages of a doc)
flags{page-view}:
  (none)
examples:
  clickup-axi doc search --query "runbook"
  clickup-axi doc view <doc-id>
  clickup-axi doc page-view <page-id>`;

interface ClickupDoc {
  id: string;
  name: string;
  doc_id?: string;
  parent_id?: string;
  date_created?: string | number;
  creator?: { id?: number; username?: string };
}

interface ClickupPage {
  id?: string;
  name?: string;
  content?: string | { content?: string[] };
  orderindex?: number;
  type?: string;
  date_created?: string | number;
  updated_at?: string | number;
}

const docSchema: FieldDef<ClickupDoc>[] = [
  field("id"),
  field("name"),
  custom("created", (d) => formatEpoch(d.date_created)),
];

const pageSchema: FieldDef<ClickupPage>[] = [field("id"), field("name"), field("orderindex")];

async function searchDocs(args: string[], ctx: ClickupContext): Promise<string> {
  const query = takeFlag(args, "--query");
  if (!query) throw new AxiError("--query <text> is required: clickup-axi doc search --query \"...\"", "VALIDATION_ERROR");
  const params: Record<string, string | undefined> = { query };
  // doc search supports scoping by parent. Default to the resolved team.
  const teamId = takeFlag(args, "--team") ?? ctx.teamId;
  const folderId = takeFlag(args, "--folder") ?? ctx.folderId;
  const listId = takeFlag(args, "--list") ?? ctx.listId;
  const spaceId = takeFlag(args, "--space") ?? ctx.spaceId;
  if (listId) params["list_id"] = listId;
  else if (folderId) params["folder_id"] = folderId;
  else if (spaceId) params["space_id"] = spaceId;
  else params["team_id"] = teamId;
  const body = await get<{ docs?: ClickupDoc[] }>(`/team/${teamId}/docs`, params);
  const docs = body?.docs ?? [];
  return renderOutput([
    formatCountLine({ count: docs.length }),
    renderList("docs", docs, docSchema),
    renderHelp(getSuggestions({ domain: "doc", action: "search", ctx })),
  ]);
}

async function viewDoc(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Doc ID is required: clickup-axi doc view <id>", "VALIDATION_ERROR");
  const doc = await get<ClickupDoc>(`/doc/${id}`);
  return renderOutput([
    renderDetail("doc", doc, docSchema),
    renderHelp(getSuggestions({ domain: "doc", action: "view", id, ctx })),
  ]);
}

async function pageList(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Doc ID is required: clickup-axi doc page-list <id>", "VALIDATION_ERROR");
  const body = await get<{ pages?: ClickupPage[] }>(`/doc/${id}/page`);
  const pages = body?.pages ?? [];
  return renderOutput([
    formatCountLine({ count: pages.length }),
    renderList("pages", pages, pageSchema),
    renderHelp(getSuggestions({ domain: "doc", action: "view", id, ctx })),
  ]);
}

async function pageView(args: string[], ctx: ClickupContext): Promise<string> {
  const id = getPositional(args, 0);
  if (!id) throw new AxiError("Page ID is required: clickup-axi doc page-view <page-id>", "VALIDATION_ERROR");
  const page = await get<ClickupPage>(`/doc/page/${id}`);
  const blocks: (string | undefined)[] = [
    renderDetail("page", { id: page.id, name: page.name, orderindex: page.orderindex, type: page.type }, [
      field("id"),
      field("name"),
      field("orderindex"),
      field("type"),
    ]),
  ];
  const content = page.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content?.content)
      ? (content?.content as string[]).join("\n")
      : "";
  blocks.push(renderDetail("content", { body: truncateBody(text, 2000) }, [field("body")]));
  blocks.push(renderHelp(getSuggestions({ domain: "doc", action: "view", id, ctx })));
  return renderOutput(blocks);
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
    case "page-list":
      return pageList(rest, ctx);
    case "page-view":
      return pageView(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: search, view, page-list, page-view",
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
