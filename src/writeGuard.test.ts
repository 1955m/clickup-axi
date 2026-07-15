import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveWriteGate, writeGateLabel } from "./writeGuard.js";

describe("resolveWriteGate", () => {
  beforeEach(() => {
    delete process.env["FM_CLICKUP_EXECUTE"];
  });
  afterEach(() => {
    delete process.env["FM_CLICKUP_EXECUTE"];
  });

  it("defaults to dry-run when neither flag is set", () => {
    const gate = resolveWriteGate(false, false);
    expect(gate.execute).toBe(false);
    expect(gate.dryRun).toBe(true);
  });

  it("executes when --execute is passed", () => {
    const gate = resolveWriteGate(true, false);
    expect(gate.execute).toBe(true);
    expect(gate.dryRun).toBe(false);
  });

  it("executes when FM_CLICKUP_EXECUTE=1 env is set", () => {
    process.env["FM_CLICKUP_EXECUTE"] = "1";
    const gate = resolveWriteGate(false, false);
    expect(gate.execute).toBe(true);
  });

  it("rejects combining --dry-run and --execute", () => {
    expect(() => resolveWriteGate(true, true)).toThrow();
  });

  it("stays dry-run when only --dry-run is passed", () => {
    const gate = resolveWriteGate(false, true);
    expect(gate.execute).toBe(false);
    expect(gate.dryRun).toBe(true);
  });
});

describe("writeGateLabel", () => {
  it("labels dry-run vs executed", () => {
    expect(writeGateLabel({ execute: false, dryRun: true })).toBe("dry-run");
    expect(writeGateLabel({ execute: true, dryRun: false })).toBe("executed");
  });
});