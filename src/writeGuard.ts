import { AxiError } from "./errors.js";

/**
 * Write guardrail: all mutations default to DRY-RUN. They print exactly what
 * they WOULD do and require `--execute` (or `FM_CLICKUP_EXECUTE=1`) to actually
 * hit the ClickUp API. Mirrors the reference `MIRROR_I_UNDERSTAND` env + the
 * axi-suite-plan §4.5 `--dry-run`/`--execute` guardrails.
 *
 * Read-only commands never call this.
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
  return { execute, dryRun: !execute };
}

/**
 * Render the summary line that annotates every write output so an agent (and
 * a human reviewer) can tell at a glance whether the ClickUp side changed.
 */
export function writeGateLabel(gate: WriteGateResult): string {
  return gate.execute ? "executed" : "dry-run";
}
