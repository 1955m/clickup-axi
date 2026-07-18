import { encode } from "@toon-format/toon";
import { get } from "../clickup.js";
import { field, renderList, renderHelp, renderOutput } from "../toon.js";
import { getSuggestions } from "../suggestions.js";
import { rejectUnknownFlags, type ClickupContext } from "../context.js";

export const HOME_HELP = "";

interface ClickupSpace {
  id: string;
  name: string;
  private?: boolean;
}

interface ClickupFolder {
  id: string;
  name: string;
  hidden?: boolean;
}

interface ClickupList {
  id: string;
  name: string;
}

const spaceSchema = [field("id"), field("name")];
const folderSchema = [field("id"), field("name")];
const listSchema = [field("id"), field("name")];

async function safeGet<T>(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T | undefined> {
  try {
    return await get<T>(path, params);
  } catch {
    return undefined;
  }
}

export async function homeCommand(_args: string[], ctx: ClickupContext): Promise<string> {
  rejectUnknownFlags(_args, [], "home");
  const blocks: (string | undefined)[] = [];

  blocks.push(encode({ team: ctx.teamId, space: ctx.spaceId }));

  const spaceBody = await safeGet<{ spaces?: ClickupSpace[] }>(`/team/${ctx.teamId}/space`, {
    archived: "false",
  });
  const spaces = spaceBody?.spaces ?? [];
  blocks.push(spaces.length ? renderList("spaces", spaces.slice(0, 5), spaceSchema) : "spaces: 0");

  const [folderBody, listBody] = await Promise.all([
    safeGet<{ folders?: ClickupFolder[] }>(`/space/${ctx.spaceId}/folder`, { archived: "false" }),
    safeGet<{ lists?: ClickupList[] }>(`/space/${ctx.spaceId}/list`, { archived: "false" }),
  ]);
  const folders = folderBody?.folders ?? [];
  const folderlessLists = listBody?.lists ?? [];
  blocks.push(
    folders.length ? renderList("folders", folders.slice(0, 5), folderSchema) : "folders: 0",
  );
  blocks.push(
    folderlessLists.length
      ? renderList("lists", folderlessLists.slice(0, 5), listSchema)
      : "lists: 0",
  );

  const hints: string[] = [];
  if (spaces.length >= 5) hints.push("Run `clickup-axi space list` for the full space list");
  if (folders.length >= 5) hints.push("Run `clickup-axi folder list` for the full folder list");
  if (folderlessLists.length >= 5) hints.push("Run `clickup-axi list list` for the full list list");
  const suggestions = getSuggestions({ domain: "home", action: "home", ctx });
  blocks.push(renderHelp([...hints, ...suggestions]));
  return renderOutput(blocks);
}
