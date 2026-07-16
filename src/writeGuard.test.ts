import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveWriteGate, writeGateLabel } from "./writeGuard.js";
import { isReadonlyEnforced, resetReadonlyCache } from "./config.js";

describe("resolveWriteGate", () => {
  beforeEach(() => {
    delete process.env["FM_CLICKUP_EXECUTE"];
    delete process.env["CLICKUP_AXI_READONLY"];
    resetReadonlyCache();
  });
  afterEach(() => {
    delete process.env["FM_CLICKUP_EXECUTE"];
    delete process.env["CLICKUP_AXI_READONLY"];
    resetReadonlyCache();
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

  it("refuses --execute when the readonly gate is enforced (company account)", () => {
    process.env["CLICKUP_AXI_READONLY"] = "1";
    expect(() => resolveWriteGate(true, false)).toThrowError(/Read-only mode is enforced/);
  });

  it("refuses FM_CLICKUP_EXECUTE=1 when the readonly gate is enforced", () => {
    process.env["CLICKUP_AXI_READONLY"] = "1";
    process.env["FM_CLICKUP_EXECUTE"] = "1";
    expect(() => resolveWriteGate(false, false)).toThrowError(/captain/);
  });

  it("still allows dry-run previews when the readonly gate is enforced", () => {
    process.env["CLICKUP_AXI_READONLY"] = "1";
    const gate = resolveWriteGate(false, false);
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

describe("isReadonlyEnforced", () => {
  beforeEach(() => {
    delete process.env["CLICKUP_AXI_READONLY"];
    resetReadonlyCache();
  });
  afterEach(() => {
    delete process.env["CLICKUP_AXI_READONLY"];
    resetReadonlyCache();
  });

  it("is off by default (no env, no marker file on a clean box)", () => {
    expect(isReadonlyEnforced()).toBe(false);
  });

  it("turns on via CLICKUP_AXI_READONLY=1", () => {
    process.env["CLICKUP_AXI_READONLY"] = "1";
    resetReadonlyCache();
    expect(isReadonlyEnforced()).toBe(true);
  });

  it("turns on via CLICKUP_AXI_READONLY=true (case-insensitive)", () => {
    process.env["CLICKUP_AXI_READONLY"] = "TRUE";
    resetReadonlyCache();
    expect(isReadonlyEnforced()).toBe(true);
  });
});
