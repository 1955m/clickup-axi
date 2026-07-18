import { get } from "./clickup.js";
import { AxiError } from "./errors.js";

/**
 * Resolve a human "--path" like "ExampleSpace/Backend/API Tasks" into ClickUp IDs by
 * walking the team → space → folder → list hierarchy by NAME (case-insensitive).
 *
 * Supported shapes:
 *   "Space"                          → { spaceId }
 *   "Space/Folder"                   → { spaceId, folderId }
 *   "Space/Folder/List"              → { spaceId, folderId, listId }
 *   "Space/List" (folderless list)   → { spaceId, listId } (falls back when no
 *                                       folder matches the second segment)
 *
 * Throws AxiError (VALIDATION_ERROR) listing the available names when a
 * segment does not resolve, so agents never guess at opaque IDs.
 */
export interface ResolvedPath {
  spaceId?: string;
  folderId?: string;
  listId?: string;
  matched: string[];
}

interface Named {
  id: string;
  name: string;
}

function findByName<T extends Named>(items: T[], name: string): T | undefined {
  const lower = name.trim().toLowerCase();
  return items.find((x) => (x.name ?? "").trim().toLowerCase() === lower);
}

function availableNames(items: Named[]): string {
  return (
    items
      .map((x) => x.name ?? "(unnamed)")
      .sort()
      .join(", ") || "none"
  );
}

export async function resolvePath(path: string, teamId: string): Promise<ResolvedPath> {
  const segments = path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    throw new AxiError("--path is empty", "VALIDATION_ERROR", ['Use --path "Space/Folder/List"']);
  }
  const result: ResolvedPath = { matched: [] };

  // Segment 0: space
  const spaceBody = await get<{ spaces?: Named[] }>(`/team/${teamId}/space`, { archived: "false" });
  const spaces = spaceBody?.spaces ?? [];
  const space = findByName(spaces, segments[0]);
  if (!space) {
    throw new AxiError(
      `--path: space "${segments[0]}" not found in team ${teamId}. Available: ${availableNames(spaces)}`,
      "VALIDATION_ERROR",
      ["Run `clickup-axi space list` to browse spaces"],
    );
  }
  result.spaceId = space.id;
  result.matched.push(space.name);

  if (segments.length === 1) return result;

  // Segment 1: folder (or folderless list)
  const folderBody = await get<{ folders?: (Named & { lists?: Named[] })[] }>(
    `/space/${space.id}/folder`,
    { archived: "false" },
  );
  const folders = folderBody?.folders ?? [];
  const folder = findByName(folders, segments[1]);

  if (folder) {
    result.folderId = folder.id;
    result.matched.push(folder.name);
    if (segments.length >= 3) {
      const lists = folder.lists ?? [];
      const list = findByName(lists, segments[2]);
      if (!list) {
        throw new AxiError(
          `--path: list "${segments[2]}" not found in folder "${folder.name}". Available: ${availableNames(lists)}`,
          "VALIDATION_ERROR",
          [`Run \`clickup-axi list list --folder ${folder.id}\` to browse lists`],
        );
      }
      result.listId = list.id;
      result.matched.push(list.name);
    }
    return result;
  }

  // No folder matched segment 1 — try a folderless list in the space.
  if (segments.length === 2) {
    const listBody = await get<{ lists?: Named[] }>(`/space/${space.id}/list`, {
      archived: "false",
    });
    const lists = listBody?.lists ?? [];
    const list = findByName(lists, segments[1]);
    if (list) {
      result.listId = list.id;
      result.matched.push(list.name);
      return result;
    }
    throw new AxiError(
      `--path: neither a folder nor a folderless list named "${segments[1]}" in space "${space.name}". Folders: ${availableNames(folders)}; folderless lists: ${availableNames(lists)}`,
      "VALIDATION_ERROR",
      [
        `Run \`clickup-axi folder list --space ${space.id}\` or \`clickup-axi list list --space ${space.id}\` to browse`,
      ],
    );
  }

  // 3+ segments but segment 1 is not a folder
  throw new AxiError(
    `--path: folder "${segments[1]}" not found in space "${space.name}". Available: ${availableNames(folders)}`,
    "VALIDATION_ERROR",
    [`Run \`clickup-axi folder list --space ${space.id}\` to browse folders`],
  );
}
