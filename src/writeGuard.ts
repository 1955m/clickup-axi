import { AxiError } from "./errors.js";
import { isReadonlyEnforced } from "./config.js";

/**
 * Write guardrail: all mutations default to DRY-RUN. They print exactly what
 * they WOULD do and require `--execute` (or `FM_CLICKUP_EXECUTE=1`) to actually
 * hit the ClickUp API. Mirrors the reference `MIRROR_I_UNDERSTAND` env + the
 * axi-suite-plan §4.5 `--dry-run`/`--execute` guardrails.
 *
 * Read-only commands never call this.
 *
 * Defense-in-depth (captain ruling 2026-07-16, COMPANY account): when the
 * readonly gate is enforced (`~/.config/clickup-axi/readonly` present, config
 * `readonly=true`, or `CLICKUP_AXI_READONLY=1`), `--execute` itself is refused
 * with a clear error. Agents must obtain the captain's explicit permission AND
 * the gate must be removed before any mutation can run.
 */

export interface WriteGateResult {
  /** True when the operation should proceed against the API. */
  execute: boolean;
  /** True when this invocation is a dry-run preview. */
  dryRun: boolean;
}

/** Resolve whether a write operation should execute or stay a dry-run. */
export function resolveWriteGate(
  executeFlag: boolean,
  dryRunFlag: boolean,
): WriteGateResult {
  if (dryRunFlag && executeFlag) {
    throw new AxiError(
      "Cannot combine --dry-run and --execute — choose one",
      "VALIDATION_ERROR",
      ["--dry-run (default) previews the mutation; --execute applies it to ClickUp"],
    );
  }
  const envExecute = (process.env["FM_CLICKUP_EXECUTE"] ?? "").trim() === "1";
  const execute = executeFlag || envExecute;
  if (execute && isReadonlyEnforced()) {
    throw new AxiError(
      "Read-only mode is enforced; captain approval + removing the readonly gate required. --execute refused against the company ClickUp account.",
      "FORBIDDEN",
      [
        "Obtain the captain's explicit permission before ANY --execute against the company workspace",
        "Remove the readonly gate to allow mutations: delete ~/.config/clickup-axi/readonly (or set readonly=false in ~/.config/clickup-axi/config.json)",
        "Dry-run previews (the default) remain available without the gate",
      ],
    );
  }
  return { execute, dryRun: !execute };
}

/**
 * Render the summary line that annotates every write output so an agent (and
 * a human reviewer) can tell at a glance whether the ClickUp side changed.
 */
export function writeGateLabel(gate: WriteGateResult): string {
  return gate.execute ? "executed" : "dry-run";
}
