# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Build / test / release gate

CI gate sequence (`.github/workflows/ci.yml`, Node 24, pnpm):
`pnpm install --frozen-lockfile` → `format:check` → `lint` → `build` → `test` → `build:skill` → `git diff --exit-code -- skills/`.

- `format:check` = prettier; `lint` = eslint `--max-warnings=0`; tests = vitest, co-located in `src/**/*.test.ts`.
- `docs:check` (= `build:skill && git diff --exit-code -- skills/`) guards SKILL.md-vs-skill.ts drift. If it fails, run `pnpm run build:skill` and commit the regenerated `skills/clickup-axi/SKILL.md`.
- Release-please (`.release-please-manifest.json` + `release-please-config.json` + `.github/workflows/release-please.yml`) drives versioned releases from conventional commits. package.json is `private:true` (npm publish is captain-gated).

## Tests are isolated from the local readonly marker

`src/test-setup.ts` (wired via `vitest.config.ts`) points `CLICKUP_AXI_CONFIG_DIR` at a fresh temp dir for the test process, so `pnpm run test` is green locally even when `~/.config/clickup-axi/readonly` (defense-in-depth for the COMPANY ClickUp account, see `config.ts:isReadonlyEnforced`) is present on the captain's box — the marker stays untouched on disk for the real runtime. Tests that need the gate ON set `CLICKUP_AXI_READONLY=1`, which takes precedence over the marker/config file.

## AXI P6: reject unknown flags

`rejectUnknownFlags(args, knownFlags, commandPath)` in `src/context.ts` runs at the top of every command/subcommand handler (after any `--help` short-circuit, before any dependency call). Globals `--help`/`--team`/`--space`/`--folder`/`--list`/`--path` always pass; the context flags are already stripped by `parseContextArgs`/`withContext` before a handler sees them. `--dry-run`/`--execute` are per-subcommand (write handlers only), NOT global. An unrecognized `--flag` throws `VALIDATION_ERROR` naming the flag + listing the valid set. When adding a new flag to a command, also add it to that handler's `rejectUnknownFlags` known-list.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
