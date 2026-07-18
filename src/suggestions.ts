import type { ClickupContext } from "./context.js";

export interface SuggestionContext {
  domain: string;
  action: string;
  id?: string;
  isEmpty?: boolean;
  state?: string;
  ctx?: ClickupContext;
}

/**
 * Build the routing-flag suffix appended to every suggestion so a runnable
 * hint reproduces the --team/--space/--folder/--list context. Flags sourced
 * from defaults (env/default IDs) are NOT repeated — only explicit overrides.
 */
function contextFlag(ctx: ClickupContext | undefined): string {
  if (!ctx) return "";
  const parts: string[] = [];
  // team/space are always resolved from defaults; only show when overridden
  // from env or flag. We can't tell flag vs env here, so omit by default and
  // rely on the agent inheriting the same env. Folder/list are explicit scopes.
  if (ctx.folderId) parts.push(`--folder ${ctx.folderId}`);
  if (ctx.listId) parts.push(`--list ${ctx.listId}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function ctx(c: SuggestionContext): string {
  return contextFlag(c.ctx);
}

interface SuggestionEntry {
  match: (c: SuggestionContext) => boolean;
  lines: (c: SuggestionContext) => string[];
}

const table: SuggestionEntry[] = [
  // Home
  {
    match: (c) => c.domain === "home",
    lines: () => [
      "Run `clickup-axi <command> <subcommand>` — commands: workspace, space, folder, list, task, comment, view, doc, time, tag, attachment, api, setup",
    ],
  },
  // Workspace / space / folder / list — list
  {
    match: (c) =>
      ["workspace", "space", "folder", "list"].includes(c.domain) &&
      c.action === "list" &&
      !c.isEmpty,
    lines: (c) => [`Run \`clickup-axi ${c.domain} view <id>${ctx(c)}\` to view details`],
  },
  {
    match: (c) =>
      ["workspace", "space", "folder", "list"].includes(c.domain) &&
      c.action === "list" &&
      c.isEmpty === true,
    lines: (c) => [
      `Run \`clickup-axi ${c.domain} create --name "..."${ctx(c)}\` to create one (writes need --execute)`,
    ],
  },
  // Hierarchy view
  {
    match: (c) =>
      ["workspace", "space", "folder", "list"].includes(c.domain) && c.action === "view",
    lines: (c) => {
      if (c.domain === "space")
        return [`Run \`clickup-axi folder list --space ${c.id}${ctx(c)}\` to see folders`];
      if (c.domain === "folder")
        return [`Run \`clickup-axi list list --folder ${c.id}${ctx(c)}\` to see lists`];
      if (c.domain === "list")
        return [`Run \`clickup-axi task list --list ${c.id}${ctx(c)}\` to see tasks`];
      return [];
    },
  },
  // Task list
  {
    match: (c) => c.domain === "task" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`clickup-axi task view <id>${ctx(c)}\` to view details`,
      `Run \`clickup-axi task create --name "..." --list <id>${ctx(c)}\` to create a task (writes need --execute)`,
    ],
  },
  {
    match: (c) => c.domain === "task" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`clickup-axi task create --name "..." --list <id>${ctx(c)}\` to create a task (writes need --execute)`,
      `Run \`clickup-axi list list${ctx(c)}\` to see other lists in the space`,
    ],
  },
  // Task view
  {
    match: (c) => c.domain === "task" && c.action === "view",
    lines: (c) => [
      `Run \`clickup-axi task comments ${c.id}${ctx(c)}\` to see comments`,
      `Run \`clickup-axi task custom-fields ${c.id}${ctx(c)}\` to see custom-field values`,
    ],
  },
  // Task create / update / delete
  {
    match: (c) => c.domain === "task" && c.action === "create",
    lines: (c) => [
      `Run \`clickup-axi task view ${c.id}${ctx(c)}\` to see the new task`,
      `Run \`clickup-axi task update ${c.id} --status <status>${ctx(c)}\` to change status (writes need --execute)`,
    ],
  },
  {
    match: (c) => c.domain === "task" && c.action === "update",
    lines: (c) => [`Run \`clickup-axi task view ${c.id}${ctx(c)}\` to see the updated task`],
  },
  {
    match: (c) => c.domain === "task" && c.action === "delete",
    lines: (c) => [`Run \`clickup-axi task list${ctx(c)}\` to see remaining tasks`],
  },
  // Task comments / custom-fields / dependencies
  {
    match: (c) =>
      c.domain === "task" && ["comments", "custom-fields", "dependencies"].includes(c.action),
    lines: (c) => [`Run \`clickup-axi task view ${c.id}${ctx(c)}\` to see the task`],
  },
  // Comment create
  {
    match: (c) => c.domain === "comment" && c.action === "create",
    lines: (c) => [`Run \`clickup-axi task view ${c.id}${ctx(c)}\` to see the task with comments`],
  },
  // Time / tag / attachment
  {
    match: (c) => c.domain === "time" && c.action === "list",
    lines: (c) => [
      `Run \`clickup-axi time create --task <id>${ctx(c)}\` to log time (writes need --execute)`,
    ],
  },
  {
    match: (c) => c.domain === "tag" && c.action === "list",
    lines: (c) => [
      `Run \`clickup-axi tag create --tag "..."${ctx(c)}\` to create a space tag (writes need --execute)`,
    ],
  },
  {
    match: (c) => c.domain === "attachment" && c.action === "list",
    lines: (c) => [
      `Run \`clickup-axi attachment upload --task <id> --file <path>${ctx(c)}\` to upload (writes need --execute)`,
    ],
  },
  // View / doc
  {
    match: (c) => c.domain === "view" && c.action === "list",
    lines: (c) => [`Run \`clickup-axi view tasks <id>${ctx(c)}\` to see tasks in a view`],
  },
  {
    match: (c) => c.domain === "doc" && c.action === "search",
    lines: (c) => [`Run \`clickup-axi doc view <id>${ctx(c)}\` to view a doc`],
  },
  // api / setup
  {
    match: (c) => c.domain === "api" || c.domain === "setup",
    lines: () => [],
  },
];

export function getSuggestions(c: SuggestionContext): string[] {
  for (const entry of table) {
    if (entry.match(c)) {
      return entry.lines(c);
    }
  }
  return [];
}
