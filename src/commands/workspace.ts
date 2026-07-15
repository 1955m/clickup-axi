import { get } from "../clickup.js";
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
import type { ClickupContext } from "../context.js";

export const WORKSPACE_HELP = `usage: clickup-axi workspace <subcommand>
subcommands[2]:
  list, view <id>
examples:
  clickup-axi workspace list
  clickup-axi workspace view ${"1000000000"}`;

interface ClickupTeam {
  id: string;
  name: string;
  color?: string;
  avatar?: string | null;
}

const listSchema: FieldDef<ClickupTeam>[] = [field("id"), field("name")];
const viewSchema: FieldDef<ClickupTeam>[] = [field("id"), field("name")];

async function listWorkspaces(args: string[], ctx: ClickupContext): Promise<string> {
  // The ClickUp /team endpoint returns the teams the token belongs to. It
  // accepts no pagination params.
  void args;
  const body = await get<{ teams?: ClickupTeam[] }>("/team");
  const list = body?.teams ?? [];
  const suggestions = getSuggestions({ domain: "workspace", action: "list", isEmpty: list.length === 0, ctx });
  return renderOutput([
    formatCountLine({ count: list.length }),
    renderList("workspaces", list, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewWorkspace(args: string[], ctx: ClickupContext): Promise<string> {
  const id = args[0];
  if (!id) return renderError("Workspace/team ID is required: clickup-axi workspace view <id>", "VALIDATION_ERROR");
  const team = await get<ClickupTeam>(`/team/${id}`);
  return renderOutput([
    renderDetail("workspace", team, viewSchema),
    renderHelp(getSuggestions({ domain: "workspace", action: "view", id, ctx })),
  ]);
}

export async function workspaceCommand(args: string[], ctx: ClickupContext): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return WORKSPACE_HELP;
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listWorkspaces(rest, ctx);
    case "view":
      return viewWorkspace(rest, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view",
      ]);
  }
}
