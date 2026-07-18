# clickup-axi

AXI-compliant wrapper around the [ClickUp API](https://developer.clickup.com/reference) — token-efficient TOON output, contextual next-step hints, custom-field-by-name resolution, `--dry-run`/`--execute` write guardrails, and `--path` hierarchy navigation. Mirrors the `gh-axi` / `glab-axi` UX so a crew fluent in either can drive ClickUp immediately.

> **COMPANY ClickUp account.** This tool targets the captain's company ClickUp workspace. Reads are safe; **every mutation defaults to `--dry-run` and needs `--execute`, and agents MUST obtain the captain's explicit permission before ANY `--execute`.** A defense-in-depth readonly gate (`~/.config/clickup-axi/readonly` present, or `config.json` `readonly=true`) refuses `--execute` even when set. Run `clickup-axi setup readonly` to inspect it.

```sh
clickup-axi                          # dashboard: team/space, spaces, folders, lists, hints
clickup-axi space list               # list spaces in the team (TOON table)
clickup-axi task list --path "ExampleSpace/ExampleSpace IDP/Roadmap"  # resolve hierarchy by name
clickup-axi list list --folder 901814661269   # lists in a folder
clickup-axi task list --list 901818824040    # tasks in a list
clickup-axi task view 86exz8ef5 --comments   # view a task + comments
clickup-axi task custom-fields 86exz8ef5     # decode custom-field values by type
clickup-axi task create --name "Ship" --list 901818824040 --set-field "Product"=Backend --execute
clickup-axi api GET "team/1000000000/space?archived=false"
```

## Why

ClickUp IDs are opaque strings; the API returns verbose JSON; custom-field IDs are volatile UUIDs that must be resolved by NAME at runtime; and writes need an explicit guardrail against accidental mutation. `clickup-axi` wraps all of that into the compact, agent-ergonomic shape `gh-axi` established: a no-args session digest, TOON-encoded lists, contextual `help[N]:` hints, structured `AxiError` codes, `--dry-run`/`--execute` guardrails, a 429-backoff fetch client, and a `--skill` generator.

## Install

```sh
npm install -g clickup-axi        # when published
# or run on demand:
npx -y clickup-axi <command>
```

Requires a ClickUp personal API token (starts with `pk_`). Resolve it via:

```
CLICKUP_API_TOKEN env  >  ~/.config/clickup-axi/token  >  ~/.config/mcp/config.json
```

**The AWS Secrets Manager fallback (`example-space/ci/tokens` / `aws --profile example-space-staging`) was REMOVED** — that key is a colleague's PERSONAL token and must never be used against the captain's company workspace. Cold storage of the captain's key is Vaultwarden (item "ClickUp API key - EXAMPLE_USER (personal)"); the runtime copy is the 600-perm token file (provisioned on this box).

```sh
echo -n "pk_..." | clickup-axi setup token   # write the token to ~/.config/clickup-axi/token (chmod 600)
clickup-axi setup auth                        # verify the resolved token + show the authorized user
```

## Commands

```
(none)=dashboard, workspace, space, folder, list, task, comment, view, doc, time, tag, attachment, checklist, goal, webhook, member, template, dependency, custom-field, group, chat, api, setup
```

| Command        | Subcommands                                                                                                                     | API Version         | Notes                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace`    | list, view, seats, plan, shared, custom-roles, custom-items                                                                     | v2                  | teams the token belongs to; shared shows shared hierarchy                                                                                                                              |
| `space`        | list, view, create, update, delete                                                                                              | v2                  | `--space` scopes; defaults to ExampleSpace `200000000000`                                                                                                                                     |
| `folder`       | list, view, create, update, delete                                                                                              | v2                  | `--folder` scopes                                                                                                                                                                      |
| `list`         | list, view, create, update, delete                                                                                              | v2                  | `--list` scopes; folderless lists via `list list --space`                                                                                                                              |
| `task`         | list, view, create, update, delete, comments, custom-fields, dependencies, time-in-status, merge, add-to-list, remove-from-list | v2                  | `--set-field NAME=value` resolves fields by NAME; `time-in-status` needs the ClickApp enabled; `merge` (POST /task/{id}/merge); add-to-list/remove-from-list (Tasks in Multiple Lists) |
| `comment`      | list, view, create, update, delete                                                                                              | v2                  | scoped by `--task` or `--view`                                                                                                                                                         |
| `view`         | list, get, create, update, delete, tasks                                                                                        | v2                  | ClickUp views (list/board/calendar...)                                                                                                                                                 |
| `doc`          | search, view, create, page-list, page-view, page-create, page-edit                                                              | **v3**              | ClickUp moved Docs to API v3; search filters by parent/creator/archived/deleted (no free-text query in v3). page content is markdown.                                                  |
| `time`         | list, create, start, stop, get, update, delete                                                                                  | v2                  | time tracking                                                                                                                                                                          |
| `tag`          | list, create, update, delete, add-to-task, remove-from-task                                                                     | v2                  | space-scoped tags                                                                                                                                                                      |
| `attachment`   | list, upload                                                                                                                    | v2                  | task attachments (multipart upload)                                                                                                                                                    |
| `checklist`    | list, create, update, delete, item-create, item-update, item-delete                                                             | v2                  | list reads from the task body (no dedicated GET endpoint); items scoped by `--checklist`                                                                                               |
| `goal`         | list, view, create, update, delete, key-result-create, key-result-update, key-result-delete                                     | v2                  | goals + key results                                                                                                                                                                    |
| `webhook`      | list, create, update, delete                                                                                                    | v2                  | health status rendered in list                                                                                                                                                         |
| `member`       | task, list, guest, guest-invite, guest-add, guest-remove                                                                        | v2                  | guest-* are Enterprise-plan only                                                                                                                                                       |
| `template`     | task-list, list-list, folder-list, task-create, list-create, folder-create                                                      | v2                  | template IDs carry `t-` prefix; publicly shared templates must be added to workspace library first                                                                                     |
| `dependency`   | add, delete, link, unlink                                                                                                       | v2                  | add/delete model dependencies (depends-on/dependency-of); link/unlink model task links. Read view at `task dependencies <id>`.                                                         |
| `custom-field` | list, set, remove                                                                                                               | v2                  | list at list/folder/space/team scope; set/remove resolve field UUID by NAME                                                                                                            |
| `group`        | list, create, update, delete                                                                                                    | v2                  | user groups (the API calls them "teams" in paths)                                                                                                                                      |
| `chat`         | channel-list, channel-view, channel-create, message-list, message-send                                                          | **v3 experimental** | ClickUp Chat is v3 and EXPERIMENTAL ("subject to change at any time" per ClickUp). Wrapped explicitly with the v3 experimental caveat.                                                 |
| `api`          | `[<method>] <path>`                                                                                                             | v2                  | raw ClickUp API v2 access                                                                                                                                                              |
| `setup`        | token, auth, workspace, readonly, hooks                                                                                         | —                   | token config, readonly gate inspection, agent SessionStart hooks                                                                                                                       |

### Honest coverage table

Every ClickUp API v2 feature area, its command, and its verified status. Items marked "Enterprise" return FORBIDDEN on non-Enterprise plans.

| Feature Area                  | Command                                                      | API                                         | Status                                                                     |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------- |
| Authorized user               | `setup auth`                                                 | v2 GET /user                                | ✅                                                                         |
| Authorized workspaces (teams) | `workspace list`                                             | v2 GET /team                                | ✅                                                                         |
| Workspace seats               | `workspace seats`                                            | v2 GET /team/{id}/seats                     | ✅                                                                         |
| Workspace plan                | `workspace plan`                                             | v2 GET /team/{id}/plan                      | ✅                                                                         |
| Custom roles                  | `workspace custom-roles`                                     | v2 GET /team/{id}/customroles               | ✅                                                                         |
| Custom task types             | `workspace custom-items`                                     | v2 GET /team/{id}/custom_item               | ✅                                                                         |
| Shared hierarchy              | `workspace shared`                                           | v2 GET /team/{id}/shared                    | ✅                                                                         |
| Spaces                        | `space list/view/create/update/delete`                       | v2                                          | ✅                                                                         |
| Folders                       | `folder list/view/create/update/delete`                      | v2                                          | ✅                                                                         |
| Folder from template          | `template folder-create`                                     | v2 POST /space/{id}/folder_template/{tid}   | ✅                                                                         |
| Lists                         | `list list/view/create/update/delete`                        | v2                                          | ✅                                                                         |
| Folderless lists              | `list list --space`                                          | v2 GET /space/{id}/list                     | ✅                                                                         |
| List from template (folder)   | `template list-create --folder`                              | v2 POST /folder/{id}/list_template/{tid}    | ✅                                                                         |
| List from template (space)    | `template list-create --space`                               | v2 POST /space/{id}/list_template/{tid}     | ✅                                                                         |
| Tasks                         | `task list/view/create/update/delete`                        | v2                                          | ✅                                                                         |
| Task from template            | `template task-create`                                       | v2 POST /list/{id}/taskTemplate/{tid}       | ✅                                                                         |
| Task add to list              | `task add-to-list`                                           | v2 POST /list/{id}/task/{id}                | ✅ (Tasks in Multiple Lists ClickApp)                                      |
| Task remove from list         | `task remove-from-list`                                      | v2 DELETE /list/{id}/task/{id}              | ✅                                                                         |
| Task merge                    | `task merge`                                                 | v2 POST /task/{id}/merge                    | ✅                                                                         |
| Task time in status           | `task time-in-status`                                        | v2 GET /task/{id}/time_in_status            | ✅ (Total Time in Status ClickApp)                                         |
| Task bulk time in status      | —                                                            | v2 GET /task/bulk_time_in_status/task_ids   | skipped (narrow use case)                                                  |
| Task time estimates           | —                                                            | v2                                          | skipped (Business Plan or above)                                           |
| Task move                     | —                                                            | —                                           | no dedicated v2 move endpoint; achieved via add-to-list + remove-from-list |
| Comments                      | `comment list/view/create/update/delete`                     | v2                                          | ✅                                                                         |
| Comment replies               | —                                                            | v2 POST /comment/{id}/reply                 | skipped (comments are flat thread by default)                              |
| Threaded comments             | —                                                            | v2                                          | skipped (v2 threaded comments are a separate surface)                      |
| Views                         | `view list/get/create/update/delete/tasks`                   | v2                                          | ✅                                                                         |
| Docs                          | `doc search/view/create/page-*`                              | **v3**                                      | ✅ (ClickUp moved Docs to v3)                                              |
| Custom fields (list)          | `custom-field list --list/--folder/--space/--team`           | v2                                          | ✅                                                                         |
| Custom fields (set/remove)    | `custom-field set/remove`                                    | v2                                          | ✅ (by NAME)                                                               |
| Set custom field value        | `task create --set-field` / `custom-field set`               | v2 POST /task/{id}/field/{fid}              | ✅                                                                         |
| Remove custom field value     | `custom-field remove`                                        | v2 DELETE /task/{id}/field/{fid}            | ✅                                                                         |
| Dependencies                  | `dependency add/delete`                                      | v2                                          | ✅                                                                         |
| Task links                    | `dependency link/unlink`                                     | v2                                          | ✅                                                                         |
| Dependencies read             | `task dependencies <id>`                                     | task body (no GET endpoint)                 | ✅ (reads embedded arrays)                                                 |
| Checklists                    | `checklist list/create/update/delete`                        | v2                                          | ✅ (list reads task body)                                                  |
| Checklist items               | `checklist item-create/item-update/item-delete`              | v2                                          | ✅                                                                         |
| Tags                          | `tag list/create/update/delete/add-to-task/remove-from-task` | v2                                          | ✅                                                                         |
| Attachments                   | `attachment list/upload`                                     | v2                                          | ✅                                                                         |
| Time tracking                 | `time list/create/start/stop/get/update/delete`              | v2                                          | ✅                                                                         |
| Time entry history            | —                                                            | v2 GET /team/{id}/time_entries/{id}/history | skipped (read-only detail)                                                 |
| Time entry tags               | —                                                            | v2                                          | skipped (infrequently used)                                                |
| Goals                         | `goal list/view/create/update/delete`                        | v2                                          | ✅                                                                         |
| Key results                   | `goal key-result-create/key-result-update/key-result-delete` | v2                                          | ✅                                                                         |
| Webhooks                      | `webhook list/create/update/delete`                          | v2                                          | ✅ (health in list)                                                        |
| Webhook health                | `webhook list`                                               | v2 (embedded)                               | ✅                                                                         |
| Members                       | `member task/list`                                           | v2                                          | ✅                                                                         |
| Guests (Enterprise)           | `member guest/guest-invite/guest-add/guest-remove`           | v2                                          | ✅ (Enterprise; dry-run default)                                           |
| User groups                   | `group list/create/update/delete`                            | v2                                          | ✅                                                                         |
| Task templates                | `template task-list`                                         | v2 GET /team/{id}/taskTemplate              | ✅                                                                         |
| List templates                | `template list-list`                                         | v2 GET /team/{id}/list_template             | ✅                                                                         |
| Folder templates              | `template folder-list`                                       | v2 GET /team/{id}/folder_template           | ✅                                                                         |
| Chat channels                 | `chat channel-list/channel-view/channel-create`              | **v3 experimental**                         | ✅ (v3; marked experimental)                                               |
| Chat messages                 | `chat message-list/message-send`                             | **v3 experimental**                         | ✅ (v3; marked experimental)                                               |
| Chat reactions/replies        | —                                                            | v3 experimental                             | skipped (detailed sub-features of v3 experimental chat)                    |
| Legacy time tracking          | —                                                            | v2                                          | skipped (deprecated; use time group)                                       |
| Audit logs                    | —                                                            | v2                                          | skipped (Enterprise Workspace owner only)                                  |
| Workspace users (Enterprise)  | —                                                            | v2 GET /team/{id}/user                      | skipped (Enterprise; narrow use)                                           |
| OAuth token                   | —                                                            | v2 POST /oauth/token                        | skipped (personal token only)                                              |

Plus the SDK built-in `update` / `update --check`.

## Context routing

`--team`, `--space`, `--folder`, `--list`, `--path` are routing flags placed **after** the command (space or equals form). Defaults: team `1000000000` (EXAMPLE_ORG), space `200000000000` (ExampleSpace). Override via `FM_CLICKUP_TEAM` / `FM_CLICKUP_SPACE` env.

```sh
clickup-axi folder list --space 200000000000
clickup-axi task list --list=901818824040
clickup-axi task list --path "ExampleSpace/Backend/API Tasks"  # resolve by name
```

`--path` walks the hierarchy by name (case-insensitive): `"Space"`, `"Space/Folder"`, `"Space/Folder/List"`, or `"Space/List"` (folderless list). Throws `VALIDATION_ERROR` listing available names when a segment doesn't resolve.

## Write guardrails

All mutations default to **dry-run**: they print the payload + `status: dry-run` and make no API call. Add `--execute` (or set `FM_CLICKUP_EXECUTE=1`) to apply. `--dry-run --execute` is rejected.

**Defense-in-depth readonly gate:** When `~/.config/clickup-axi/readonly` exists (or `config.json` `readonly=true`, or `CLICKUP_AXI_READONLY=1`), `--execute` itself is refused with `FORBIDDEN`. This is the recommended posture on the company runtime. Dry-run previews remain available. Run `clickup-axi setup readonly` to inspect.

## Custom fields by NAME

Never hardcode field UUIDs. `--set-field "Product"=Backend` resolves the field UUID by name at runtime and coerces the value (drop_down/labels option names → ids). `task custom-fields <id>` decodes the task's field values by type. `custom-field list --list <id>` shows all accessible fields at a scope.

## Rate limiting

ClickUp enforces 100 req/min with a `Retry-After` header. `clickup-axi` backs off (6 attempts, `Retry-After`-aware, exponential 2s→60s cap) before surfacing `RATE_LIMITED`.

## Output

All output is [TOON](https://www.npmjs.com/package/@toon-format/toon)-encoded: compact `label[N]{fields}:` tables for lists, `label:` key-value blocks for details, and a trailing `help[N]:` block of runnable next-step hints. Errors render as `{ error, code, help[] }` with codes `NOT_FOUND`, `AUTH_REQUIRED`, `FORBIDDEN`, `RATE_LIMITED`, `VALIDATION_ERROR`, `UNKNOWN`.

## API version coverage

- **v2** (majority of endpoints): workspace, space, folder, list, task, comment, view, time, tag, attachment, checklist, goal, webhook, member, template, dependency, custom-field, group, api.
- **v3** (ClickUp moved these out of v2): `doc` (search/view/create/page-*), `chat` (channels/messages). Both are wrapped explicitly with the version marked in their help text. `chat` is also marked EXPERIMENTAL ("subject to change at any time" per ClickUp).
- **Enterprise-only** (return FORBIDDEN on non-Enterprise): guest-* subcommands under `member`. Implemented and marked in help.

## Develop

```sh
pnpm install
pnpm build            # tsc -> dist/
pnpm test             # vitest (149 unit + in-process integration tests; no network)
pnpm lint             # eslint --max-warnings=0
pnpm format           # prettier --write .
pnpm format:check     # prettier --check .
pnpm build:skill      # regenerate skills/clickup-axi/SKILL.md from source
pnpm docs:check       # build:skill + git diff --exit-code -- skills/ (fails on SKILL.md drift)
pnpm dev <args>       # run via tsx without building
```

Tests use an injected `fetch` (`setFetchImpl`) and never touch the network. Live read-only validation against the ExampleSpace space is documented in `NOTES.md`.

## Architecture

Built on the published [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js) (provides `runAxiCli` command routing, help formatting, `AxiError`, the `update` built-in, and SessionStart hook installation) and [`@toon-format/toon`](https://www.npmjs.com/package/@toon-format/toon). The file layout mirrors `glab-axi`:

```
bin/clickup-axi.ts        entrypoint
src/cli.ts             runAxiCli wiring, TOP_HELP, --skill, context resolution, --path
src/context.ts         resolve --team/--space/--folder/--list/--path into ClickupContext
src/config.ts          token discovery (env > file > MCP), team/space defaults, v3 base, readonly gate
src/clickup.ts         fetch wrapper with 429 backoff (get/post/put/del/request) + v3 helpers
src/errors.ts          mapClickupError -> AxiError codes (HTTP status + ClickUp JSON body)
src/customFields.ts    build_field_index + resolveFieldValue + coerceFieldValue (by NAME) + set/remove
src/writeGuard.ts      --dry-run (default) / --execute guardrail + readonly gate enforcement
src/toon.ts            field extractors + renderList/renderDetail/renderHelp
src/args.ts            flag/positional helpers
src/body.ts            --body / --body-file resolution + truncation
src/format.ts          shared count-line phrasing
src/fields.ts          --fields parser
src/suggestions.ts     contextual help[N] table
src/skill.ts           createSkillMarkdown()
src/hierarchy.ts       --path "Space/Folder/List" name resolution
src/commands/*.ts      workspace, space, folder, list, task, comment, view, doc, time, tag, attachment, checklist, goal, webhook, member, template, dependency, customField, group, chat, api, setup, home
skills/clickup-axi/SKILL.md  shipped skill file for agent harness auto-loading
```

See `NOTES.md` for the build-decision rationale, sharp edges, and read-only validation evidence against the ExampleSpace space.

License: MIT.
