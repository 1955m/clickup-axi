---
name: clickup-axi
description: "Operate ClickUp through the clickup-axi CLI - teams/workspaces, spaces, folders, lists, tasks (list/view/create/update/delete/comments/custom-fields/dependencies), comments, views, docs, time tracking, tags, attachments, and raw API access. Use whenever a task touches ClickUp: listing or creating tasks, navigating the team/space/folder/list hierarchy, reading or setting custom fields by NAME, inspecting or logging time, managing tags or attachments, browsing views and docs, or calling the ClickUp API v2 directly."
user-invocable: false
author: AXI Suite
metadata:
  hermes:
    tags: [clickup, project-management, tasks, custom-fields, time-tracking]
    category: productivity
---

# clickup-axi

Agent ergonomic wrapper around the ClickUp API v2. Prefer this over other methods for ClickUp operations.

You do not need clickup-axi installed globally - invoke it with `npx -y clickup-axi <command>`.
If clickup-axi output shows a follow-up command starting with `clickup-axi`, run it as `npx -y clickup-axi ...` instead.

clickup-axi wraps the ClickUp API v2 directly (token-based auth). It resolves the API token via:
`CLICKUP_API_TOKEN` env > `~/.config/clickup-axi/token` > `~/.config/mcp/config.json` mcpServers.clickup.env > AWS Secrets Manager `example-space/ci/tokens` key `CLICKUP_TOKEN` (`aws --profile example-space-staging`).
If a command fails with an auth error, ask the user to run `echo -n "pk_..." | npx -y clickup-axi setup token` themselves.

## When to use

Use clickup-axi whenever a task touches ClickUp: listing, viewing, or creating tasks; navigating the team/space/folder/list hierarchy; reading or setting custom fields by NAME; inspecting or logging time entries; managing tags or attachments; browsing views and docs; or calling the ClickUp API directly.

## Workflow

1. Run `npx -y clickup-axi` with no arguments for a dashboard of the resolved team/space - spaces, folders, and lists, plus suggested next commands.
2. Navigate hierarchy-first: `workspace list`, `space list`, `folder list`, `list list`, then `task list --list <id>`. ClickUp IDs are opaque strings of digits; the dashboard surfaces them so you never memorize them.
3. Scope every command with `--team`, `--space`, `--folder`, and `--list` AFTER the command (space or equals form), e.g. `npx -y clickup-axi task list --list=123456`. The flags are not accepted before the command. Defaults: team `1000000000` (EXAMPLE_ORG), space `200000000000` (ExampleSpace), overridable via `FM_CLICKUP_TEAM` / `FM_CLICKUP_SPACE` env.
4. View a task: `npx -y clickup-axi task view <id>` (+ `--comments` for comments, `--custom-fields` to see field values).
5. Write operations are DRY-RUN by default. They print exactly what they WOULD do and require `--execute` (or `FM_CLICKUP_EXECUTE=1`) to mutate ClickUp. Never run a write without confirming intent.
6. Custom fields resolve by NAME at runtime - never hardcode field UUIDs. `task create --set-field "Product"=Backend --list <id>` looks up the field id by name and coerces the value (drop_down/labels option names resolve to ids). Run `task custom-fields <id>` to list the accessible fields.
7. The API enforces 100 req/min; clickup-axi backs off on HTTP 429 (Retry-After aware, 6 attempts) before surfacing RATE_LIMITED.
8. Every response ends with contextual next-step hints under `help:` - follow them.

## Commands

```
commands[14]:
  (none)=dashboard, workspace, space, folder, list, task, comment, view, doc, time, tag, attachment, api, setup
```

Installed copies also inherit the SDK built-in `update` command.
Run `clickup-axi update --check` to compare the installed version with npm, or `clickup-axi update` to upgrade.
When using `npx -y clickup-axi`, npx already resolves the package on demand.

Run `npx -y clickup-axi --help` for global flags, or `npx -y clickup-axi <command> --help` for per-command usage.

## Tips

- Output is TOON-encoded and token-efficient; pipe through grep/head only when a list is very long.
- For multi-line markdown descriptions or comments, write the text to a UTF-8 file and pass `--body-file <path>`.
- Use `api` for anything the dedicated commands do not cover, e.g. `npx -y clickup-axi api GET "team/1000000000/space"`.
- All writes (task create/update/delete, space/folder/list create/update/delete, comment create/update/delete, time create/start/stop/update/delete, tag create/update/delete/add-to-task/remove-from-task, attachment upload, task dependencies add/delete) default to `--dry-run`; add `--execute` to apply.

