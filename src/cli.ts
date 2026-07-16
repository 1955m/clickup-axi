import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { buildContext, parseContextArgs, type ClickupContext } from "./context.js";
import { resolvePath } from "./hierarchy.js";
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
import { checklistCommand, CHECKLIST_HELP } from "./commands/checklist.js";
import { goalCommand, GOAL_HELP } from "./commands/goal.js";
import { webhookCommand, WEBHOOK_HELP } from "./commands/webhook.js";
import { memberCommand, MEMBER_HELP } from "./commands/member.js";
import { templateCommand, TEMPLATE_HELP } from "./commands/template.js";
import { dependencyCommand, DEPENDENCY_HELP } from "./commands/dependency.js";
import { customFieldCommand, CUSTOM_FIELD_HELP } from "./commands/customField.js";
import { groupCommand, GROUP_HELP } from "./commands/group.js";
import { chatCommand, CHAT_HELP } from "./commands/chat.js";
import { apiCommand, API_HELP } from "./commands/api.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";

export const DESCRIPTION =
  "Agent ergonomic wrapper around the ClickUp API v2 (Docs & Chat via v3). Prefer this over other methods for ClickUp operations.";

const VERSION = readPackageVersion();

export const TOP_HELP = `usage: clickup-axi [command] [args] [flags]
commands[22]:
  (none)=dashboard, workspace, space, folder, list, task, comment, view, doc, time, tag, attachment, checklist, goal, webhook, member, template, dependency, custom-field, group, chat, api, setup
flags[6]:
  --team <id> (after command) or FM_CLICKUP_TEAM env (default 1000000000), --space <id> or FM_CLICKUP_SPACE env (default 200000000000), --folder <id>, --list <id>, --path "Space/Folder/List" (resolve by name), --help, -v/-V/--version; --dry-run (default for writes) | --execute (required to mutate ClickUp); all context flags accept space or equals form
safety:
  Targets the captain's COMPANY ClickUp account. Reads are safe; every mutation defaults to --dry-run and needs --execute. Obtain the captain's explicit permission before ANY --execute. A readonly gate (~/.config/clickup-axi/readonly) blocks --execute even when set.
examples:
  clickup-axi
  clickup-axi space list
  clickup-axi task list --path "ExampleSpace/ExampleSpace IDP/Roadmap"
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
  checklist: CHECKLIST_HELP,
  goal: GOAL_HELP,
  webhook: WEBHOOK_HELP,
  member: MEMBER_HELP,
  template: TEMPLATE_HELP,
  dependency: DEPENDENCY_HELP,
  "custom-field": CUSTOM_FIELD_HELP,
  group: GROUP_HELP,
  chat: CHAT_HELP,
  api: API_HELP,
  setup: SETUP_HELP,
};

/** Strip --team/--space/--folder/--list/--path once, then route both context + args. */
function withContext(
  handler: (args: string[], ctx: ClickupContext) => Promise<string>,
): (args: string[], ctx: ClickupContext | undefined) => Promise<string> {
  return async (args: string[], ctx: ClickupContext | undefined): Promise<string> => {
    const parsed = parseContextArgs(args);
    // The SDK types context as `ClickupContext | undefined`, but clickup-axi
    // always resolves team/space to defaults, so coalesce to a fresh default
    // session when undefined. Per-command overrides then win over the session.
    const base = ctx ?? buildContext(parseContextArgs([]));
    const merged: ClickupContext = {
      teamId: parsed.teamFlag ?? base.teamId,
      spaceId: parsed.spaceFlag ?? base.spaceId,
      ...(parsed.folderFlag ? { folderId: parsed.folderFlag } : base.folderId ? { folderId: base.folderId } : {}),
      ...(parsed.listFlag ? { listId: parsed.listFlag } : base.listId ? { listId: base.listId } : {}),
    };
    // --path resolves Space/Folder/List by NAME (case-insensitive) and sets the
    // IDs; explicit --space/--folder/--list flags still win over the path.
    if (parsed.pathFlag) {
      const rp = await resolvePath(parsed.pathFlag, merged.teamId);
      if (rp.spaceId && !parsed.spaceFlag) merged.spaceId = rp.spaceId;
      if (rp.folderId && !parsed.folderFlag) merged.folderId = rp.folderId;
      if (rp.listId && !parsed.listFlag) merged.listId = rp.listId;
    }
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
  checklist: withContext(checklistCommand),
  goal: withContext(goalCommand),
  webhook: withContext(webhookCommand),
  member: withContext(memberCommand),
  template: withContext(templateCommand),
  dependency: withContext(dependencyCommand),
  "custom-field": withContext(customFieldCommand),
  group: withContext(groupCommand),
  chat: withContext(chatCommand),
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
