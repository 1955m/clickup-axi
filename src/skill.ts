import { DESCRIPTION, TOP_HELP } from "./cli.js";

/** Trigger string agents match against to auto-load the skill. */
export const SKILL_DESCRIPTION =
  "Operate ClickUp through the clickup-axi CLI - workspaces, spaces, folders, lists, tasks (list/view/create/update/delete/comments/custom-fields/dependencies/time-in-status/merge), " +
  "comments, views (create/update/delete), docs (v3), time tracking, tags, attachments, checklists, goals + key results, webhooks, members + guests, templates, " +
  "dependencies + task links, custom fields by NAME, user groups, chat (v3 experimental), --path hierarchy navigation, and raw API access. " +
  "Use whenever a task touches ClickUp: listing or creating tasks, navigating the team/space/folder/list hierarchy (by ID or --path name), reading or " +
  "setting custom fields by NAME, inspecting or logging time, managing tags/attachments/checklists/goals/webhooks, browsing views and docs, or calling the " +
  "ClickUp API directly.";

export const SKILL_AUTHOR = "AXI Suite";

export const HERMES_TAGS = [
  "clickup",
  "project-management",
  "tasks",
  "custom-fields",
  "time-tracking",
];

export const HERMES_CATEGORY = "productivity";

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

/** Extract the `commands[N]:` block from the top-level help. */
export function extractCommandsBlock(): string {
  const match = TOP_HELP.match(/^(commands\[\d+\]:\n(?: {2}.*\n)+)/m);
  if (!match) {
    throw new Error("Could not find commands block in TOP_HELP");
  }
  return match[1].trimEnd();
}

/** Render the installable SKILL.md for the clickup-axi skill. */
export function createSkillMarkdown(): string {
  return `---
name: clickup-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

# clickup-axi

${DESCRIPTION}

> **COMPANY ClickUp account.** This tool targets the captain's company ClickUp workspace. Reads are safe; **every mutation defaults to --dry-run and needs --execute, and you MUST obtain the captain's explicit permission before ANY --execute.** A defense-in-depth readonly gate (~/.config/clickup-axi/readonly) refuses --execute even when set.

You do not need clickup-axi installed globally - invoke it with \`npx -y clickup-axi <command>\`.
If clickup-axi output shows a follow-up command starting with \`clickup-axi\`, run it as \`npx -y clickup-axi ...\` instead.

clickup-axi wraps the ClickUp API directly. Most groups use API v2; **Docs and Chat are served by API v3** (ClickUp moved them out of v2) and are wrapped explicitly with the version marked in their help text. It resolves the API token via:
\`CLICKUP_API_TOKEN\` env > \`~/.config/clickup-axi/token\` > \`~/.config/mcp/config.json\` mcpServers.clickup.env.
**The AWS Secrets Manager fallback was REMOVED** — that key (\`example-space/ci/tokens\`) is a colleague's PERSONAL token and must never be used against the company workspace. Cold storage of the captain's key is Vaultwarden (item "ClickUp API key - EXAMPLE_USER (personal)"); the runtime copy is the 600-perm token file.
If a command fails with an auth error, ask the user to run \`echo -n "pk_..." | npx -y clickup-axi setup token\` themselves.

## When to use

Use clickup-axi whenever a task touches ClickUp: listing, viewing, or creating tasks; navigating the team/space/folder/list hierarchy (by ID or by --path name); reading or setting custom fields by NAME; inspecting or logging time entries; managing tags, attachments, checklists, goals, webhooks, members, guests, templates, or user groups; browsing views and docs; or calling the ClickUp API directly.

## Workflow

1. Run \`npx -y clickup-axi\` with no arguments for a dashboard of the resolved team/space - spaces, folders, and lists, plus suggested next commands.
2. Navigate hierarchy-first: \`workspace list\`, \`space list\`, \`folder list\`, \`list list\`, then \`task list --list <id>\`. ClickUp IDs are opaque strings of digits; the dashboard surfaces them so you never memorize them. **Or use --path to resolve by name**: \`task list --path "ExampleSpace/ExampleSpace IDP/Roadmap"\` walks team -> space -> folder -> list by NAME (case-insensitive).
3. Scope every command with \`--team\`, \`--space\`, \`--folder\`, and \`--list\` AFTER the command (space or equals form), e.g. \`npx -y clickup-axi task list --list=123456\`. The flags are not accepted before the command. Defaults: team \`1000000000\` (EXAMPLE_ORG), space \`200000000000\` (ExampleSpace), overridable via \`FM_CLICKUP_TEAM\` / \`FM_CLICKUP_SPACE\` env.
4. View a task: \`npx -y clickup-axi task view <id>\` (+ \`--comments\` for comments, \`--custom-fields\` to see field values, \`--full\` for the whole description).
5. Write operations are DRY-RUN by default. They print exactly what they WOULD do and require \`--execute\` (or \`FM_CLICKUP_EXECUTE=1\`) to mutate ClickUp. **Never run a write without the captain's explicit permission** — this is the company account. The readonly gate (~/.config/clickup-axi/readonly) blocks --execute even when set; run \`setup readonly\` to inspect it.
6. Custom fields resolve by NAME at runtime - never hardcode field UUIDs. \`task create --set-field "Product"=Backend --list <id>\` looks up the field id by name and coerces the value (drop_down/labels option names resolve to ids). Run \`task custom-fields <id>\` or \`custom-field list --list <id>\` to list the accessible fields.
7. The API enforces 100 req/min; clickup-axi backs off on HTTP 429 (Retry-After aware, 6 attempts) before surfacing RATE_LIMITED.
8. Every response ends with contextual next-step hints under \`help:\` - follow them.

## Commands

\`\`\`
${extractCommandsBlock()}
\`\`\`

## API version coverage (honest)

- **v2**: workspace (+seats/plan/shared/custom-roles/custom-items), space, folder, list, task (+time-in-status/merge/add-to-list/remove-from-list), comment, view (+create/update/delete), time, tag, attachment, checklist, goal, webhook, member (+guests), template, dependency (+link/unlink), custom-field, group, api, setup.
- **v3**: doc (search/view/create/page-list/page-view/page-create/page-edit) — ClickUp moved Docs to API v3; the help text marks it. chat (channel-list/channel-view/channel-create/message-list/message-send) — v3 and EXPERIMENTAL ("subject to change at any time" per ClickUp); the help text marks it.
- **Enterprise-only (return FORBIDDEN on non-Enterprise)**: guest-invite, guest-add/remove, workspace user management. Implemented and marked in help.

Installed copies also inherit the SDK built-in \`update\` command.
Run \`clickup-axi update --check\` to compare the installed version with npm, or \`clickup-axi update\` to upgrade.
When using \`npx -y clickup-axi\`, npx already resolves the package on demand.

Run \`npx -y clickup-axi --help\` for global flags, or \`npx -y clickup-axi <command> --help\` for per-command usage.

## Tips

- Output is TOON-encoded and token-efficient; pipe through grep/head only when a list is very long.
- For multi-line markdown descriptions or comments, write the text to a UTF-8 file and pass \`--body-file <path>\`.
- Use \`api\` for anything the dedicated commands do not cover, e.g. \`npx -y clickup-axi api GET "team/1000000000/space"\`.
- All writes default to \`--dry-run\`; add \`--execute\` to apply (captain permission required — company account). This covers: space/folder/list create/update/delete, task create/update/delete + dependencies/links/merge + add-to-list/remove-from-list, comment create/update/delete, view create/update/delete, doc create/page-create/page-edit (v3), time create/start/stop/update/delete, tag create/update/delete/add-to-task/remove-from-task, attachment upload, checklist create/update/delete/item-create/item-update/item-delete, goal create/update/delete/key-result-create/key-result-update/key-result-delete, webhook create/update/delete, guest-invite/guest-add/guest-remove, template task-create/list-create/folder-create, group create/update/delete, chat channel-create/message-send (v3 experimental).
`;
}
