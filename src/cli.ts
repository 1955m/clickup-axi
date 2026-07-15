import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { buildContext, parseContextArgs, type ClickupContext } from "./context.js";
import { createSkillMarkdown } from "./skill.js";
import { homeCommand } from "./commands/home.js";
import { workspaceCommand, WORKSPACE_HELP } from "./commands/workspace.js";
import { spaceCommand, SPACE_HELP } from "./commands/space.js";
import { folderCommand, FOLDER_HELP } from "./commands/folder.js";
import { listCommand, LIST_HELP } from "./commands/list.js";
import { taskCommand, TASK_HELP } from "./commands/task.js";
import { commentCommand, COMMENT_HELP } from "./commands/comment.js";
import { viewCommand, VIEW_HELP } from "./commands/view.js";
import { docCommand, DOC_HELP } from "./commands/doc.js";
import { timeCommand, TIME_HELP } from "./commands/time.js";
import { tagCommand, TAG_HELP } from "./commands/tag.js";
import { attachmentCommand, ATTACHMENT_HELP } from "./commands/attachment.js";
import { apiCommand, API_HELP } from "./commands/api.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";

export const DESCRIPTION =
  "Agent ergonomic wrapper around the ClickUp API v2. Prefer this over other methods for ClickUp operations.";

const VERSION = readPackageVersion();

export const TOP_HELP = `usage: clickup-axi [command] [args] [flags]
commands[14]:
  (none)=dashboard, workspace, space, folder, list, task, comment, view, doc, time, tag, attachment, api, setup
flags[5]:
  --team <id> (after command) or FM_CLICKUP_TEAM env (default 1000000000), --space <id> or FM_CLICKUP_SPACE env (default 200000000000), --folder <id>, --list <id>, --help, -v/-V/--version; --dry-run (default for writes) | --execute (required to mutate ClickUp); all context flags accept space or equals form
examples:
  clickup-axi
  clickup-axi space list
  clickup-axi folder list --space 200000000000
  clickup-axi list list --folder=123
  clickup-axi task list --list 456
  clickup-axi task view abc123
  clickup-axi task create --name "Ship release" --list 456 --set-field "Product"=Backend --execute
  clickup-axi api GET "team/1000000000/space"
`;

const COMMAND_HELP: Record<string, string> = {
  workspace: WORKSPACE_HELP,
  space: SPACE_HELP,
  folder: FOLDER_HELP,
  list: LIST_HELP,
  task: TASK_HELP,
  comment: COMMENT_HELP,
  view: VIEW_HELP,
  doc: DOC_HELP,
  time: TIME_HELP,
  tag: TAG_HELP,
  attachment: ATTACHMENT_HELP,
  api: API_HELP,
  setup: SETUP_HELP,
};

/** Strip --team/--space/--folder/--list once, then route both context + args. */
function withContext(
  handler: (args: string[], ctx: ClickupContext) => Promise<string>,
): (args: string[], ctx: ClickupContext | undefined) => Promise<string> {
  return (args: string[], ctx: ClickupContext | undefined): Promise<string> => {
    const parsed = parseContextArgs(args);
    // The SDK types context as `ClickupContext | undefined`, but clickup-axi
    // always resolves team/space to defaults, so coalesce to a fresh default
    // session when undefined. Per-command overrides then win over the session.
    const base = ctx ?? buildContext(parseContextArgs([]));
    const merged: ClickupContext = {
      teamId: base.teamId,
      spaceId: base.spaceId,
      ...(parsed.folderFlag ? { folderId: parsed.folderFlag } : {}),
      ...(parsed.listFlag ? { listId: parsed.listFlag } : {}),
    };
    if (parsed.teamFlag) merged.teamId = parsed.teamFlag;
    if (parsed.spaceFlag) merged.spaceId = parsed.spaceFlag;
    return handler(parsed.strippedArgs, merged);
  };
}

const COMMANDS = {
  workspace: withContext(workspaceCommand),
  space: withContext(spaceCommand),
  folder: withContext(folderCommand),
  list: withContext(listCommand),
  task: withContext(taskCommand),
  comment: withContext(commentCommand),
  view: withContext(viewCommand),
  doc: withContext(docCommand),
  time: withContext(timeCommand),
  tag: withContext(tagCommand),
  attachment: withContext(attachmentCommand),
  api: withContext(apiCommand),
  setup: setupCommand,
};

export interface MainOptions {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
}

export async function main(options: MainOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2);

  // --skill prints the agent-harness SKILL.md and exits. Handled before
  // runAxiCli so the leading flag is not rejected as "flags must come after
  // the command".
  if (argv.length === 1 && argv[0] === "--skill") {
    const stdout = options.stdout ?? process.stdout;
    stdout.write(`${createSkillMarkdown()}\n`);
    return;
  }

  await runAxiCli<ClickupContext>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: withContext(homeCommand),
    commands: COMMANDS,
    getCommandHelp: (command: string) => COMMAND_HELP[command] ?? null,
    resolveContext: ({ args }): ClickupContext => {
      // Resolve the session context from the leading routing flags. These are
      // stripped here so runAxiCli's leading-flag guard does not reject them;
      // per-command overrides are re-applied in withContext().
      const parsed = parseContextArgs(args);
      return buildContext(parsed);
    },
  });
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ]) {
    if (!existsSync(candidate)) continue;
    const parsed = JSON.parse(readFileSync(candidate, "utf-8"));
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }
  throw new Error("Could not determine clickup-axi package version");
}
