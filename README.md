# clickup-axi

AXI-compliant wrapper around the [ClickUp API v2](https://developer.clickup.com/reference) — token-efficient TOON output, contextual next-step hints, custom-field-by-name resolution, and `--dry-run`/`--execute` write guardrails. Mirrors the `gh-axi` / `glab-axi` UX so a crew fluent in either can drive ClickUp immediately.

```sh
clickup-axi                          # dashboard: team/space, spaces, folders, lists, hints
clickup-axi space list               # list spaces in the team (TOON table)
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
CLICKUP_API_TOKEN env  >  ~/.config/clickup-axi/token  >  ~/.config/mcp/config.json  >  AWS Secrets Manager example-space/ci/tokens
```

```sh
echo -n "pk_..." | clickup-axi setup token   # write the token to ~/.config/clickup-axi/token (chmod 600)
clickup-axi setup auth                        # verify the resolved token + show the authorized user
```

CI/CD fallback: `aws --profile example-space-staging secretsmanager get-secret-value --secret-id example-space/ci/tokens --query SecretString --output text | jq -r '.CLICKUP_TOKEN'` must be reachable.

## Commands

```
(none)=dashboard, workspace, space, folder, list, task, comment, view, doc, time, tag, attachment, api, setup
```

| Command | Subcommands | Notes |
| --- | --- | --- |
| `workspace` | list, view | teams the token belongs to |
| `space` | list, view, create, update, delete | `--space` scopes; defaults to ExampleSpace `200000000000` |
| `folder` | list, view, create, update, delete | `--folder` scopes |
| `list` | list, view, create, update, delete | `--list` scopes; folderless lists via `list list --space` |
| `task` | list, view, create, update, delete, comments, custom-fields, dependencies | `--set-field NAME=value` resolves fields by NAME |
| `comment` | list, view, create, update, delete | scoped by `--task` or `--view` |
| `view` | list, get, tasks | ClickUp views (list/board/calendar...) |
| `doc` | search, view, page-list, page-view | ClickUp docs + pages |
| `time` | list, create, start, stop, get, update, delete | time tracking |
| `tag` | list, create, update, delete, add-to-task, remove-from-task | space-scoped tags |
| `attachment` | list, upload | task attachments (multipart upload) |
| `api` | `[<method>] <path>` | raw ClickUp API v2 access |
| `setup` | token, auth, workspace, hooks | token config + agent SessionStart hooks |

Plus the SDK built-in `update` / `update --check`.

## Context routing

`--team`, `--space`, `--folder`, `--list` are routing flags placed **after** the command (space or equals form). Defaults: team `1000000000` (EXAMPLE_ORG), space `200000000000` (ExampleSpace). Override via `FM_CLICKUP_TEAM` / `FM_CLICKUP_SPACE` env.

```sh
clickup-axi folder list --space 200000000000
clickup-axi task list --list=901818824040
```

## Write guardrails

All mutations default to **dry-run**: they print the payload + `status: dry-run` and make no API call. Add `--execute` (or set `FM_CLICKUP_EXECUTE=1`) to apply. `--dry-run --execute` is rejected.

## Custom fields by NAME

Never hardcode field UUIDs. `--set-field "Product"=Backend` resolves the field UUID by name at runtime and coerces the value (drop_down/labels option names → ids). `task custom-fields <id>` decodes the task's field values by type.

## Rate limiting

ClickUp enforces 100 req/min with a `Retry-After` header. `clickup-axi` backs off (6 attempts, `Retry-After`-aware, exponential 2s→60s cap) before surfacing `RATE_LIMITED`.

## Output

All output is [TOON](https://www.npmjs.com/package/@toon-format/toon)-encoded: compact `label[N]{fields}:` tables for lists, `label:` key-value blocks for details, and a trailing `help[N]:` block of runnable next-step hints. Errors render as `{ error, code, help[] }` with codes `NOT_FOUND`, `AUTH_REQUIRED`, `FORBIDDEN`, `RATE_LIMITED`, `VALIDATION_ERROR`, `UNKNOWN`.

## Develop

```sh
pnpm install
pnpm build            # tsc -> dist/
pnpm test             # vitest (87 unit + in-process integration tests; no network)
pnpm lint             # eslint --max-warnings=0
pnpm build:skill      # regenerate skills/clickup-axi/SKILL.md from source
pnpm dev <args>       # run via tsx without building
```

Tests use an injected `fetch` (`setFetchImpl`) and never touch the network. Live read-only validation against the ExampleSpace space is documented in `NOTES.md`.

## Architecture

Built on the published [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js) (provides `runAxiCli` command routing, help formatting, `AxiError`, the `update` built-in, and SessionStart hook installation) and [`@toon-format/toon`](https://www.npmjs.com/package/@toon-format/toon). The file layout mirrors `glab-axi`:

```
bin/clickup-axi.ts        entrypoint
src/cli.ts             runAxiCli wiring, TOP_HELP, --skill, context resolution
src/context.ts         resolve --team/--space/--folder/--list into ClickupContext
src/config.ts          token discovery (env > file > MCP > AWS SM) + team/space defaults
src/clickup.ts         fetch wrapper with 429 backoff (get/post/put/del/request)
src/errors.ts          mapClickupError -> AxiError codes (HTTP status + ClickUp JSON body)
src/customFields.ts    build_field_index + resolveFieldValue + coerceFieldValue (by NAME)
src/writeGuard.ts      --dry-run (default) / --execute guardrail
src/toon.ts            field extractors + renderList/renderDetail/renderHelp
src/args.ts            flag/positional helpers
src/body.ts            --body / --body-file resolution + truncation
src/format.ts          shared count-line phrasing
src/fields.ts          --fields parser
src/suggestions.ts     contextual help[N] table
src/skill.ts           createSkillMarkdown()
src/commands/*.ts      workspace, space, folder, list, task, comment, view, doc, time, tag, attachment, api, setup, home
skills/clickup-axi/SKILL.md  shipped skill file for agent harness auto-loading
```

See `NOTES.md` for the build-decision rationale, sharp edges (e.g. `GET /task/{id}/dependency` returns 405), and read-only validation evidence against the ExampleSpace space.

License: MIT.
