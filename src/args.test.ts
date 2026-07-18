import { describe, expect, it } from "vitest";
import {
  getFlag,
  takeFlag,
  hasFlag,
  takeBoolFlag,
  getAllFlags,
  getPositional,
  requireNumber,
  takeNumber,
} from "./args.js";

describe("args helpers", () => {
  it("getFlag reads space and equals form without mutating", () => {
    expect(getFlag(["--name", "x"], "--name")).toBe("x");
    expect(getFlag(["--name=x"], "--name")).toBe("x");
    expect(getFlag(["--other", "y"], "--name")).toBeUndefined();
    const args = ["--name", "x"];
    getFlag(args, "--name");
    expect(args).toEqual(["--name", "x"]); // unchanged
  });

  it("takeFlag removes the flag pair", () => {
    const args = ["--name", "x", "--state", "open"];
    expect(takeFlag(args, "--name")).toBe("x");
    expect(args).toEqual(["--state", "open"]);
    const args2 = ["--name=x", "--state=open"];
    expect(takeFlag(args2, "--name")).toBe("x");
    expect(args2).toEqual(["--state=open"]);
  });

  it("hasFlag and takeBoolFlag", () => {
    expect(hasFlag(["--draft"], "--draft")).toBe(true);
    expect(hasFlag(["--draft"], "--squash")).toBe(false);
    const args = ["--draft", "x"];
    expect(takeBoolFlag(args, "--draft")).toBe(true);
    expect(args).toEqual(["x"]);
  });

  it("getAllFlags collects repeatable flags", () => {
    expect(getAllFlags(["--label", "a", "--label", "b"], "--label")).toEqual(["a", "b"]);
    expect(getAllFlags(["--label=a", "--label=b"], "--label")).toEqual(["a", "b"]);
    expect(getAllFlags(["--label", "a"], "--label")).toEqual(["a"]);
  });

  it("getPositional returns first non-dash arg from startIndex", () => {
    // getPositional is called AFTER value-flags are stripped via takeFlag, so
    // the first remaining non-dash token is the positional.
    expect(getPositional(["pos1", "--flag", "val"], 0)).toBe("pos1");
    expect(getPositional(["--flag", "val"], 0)).toBe("val");
    expect(getPositional(["--flag", "val", "--other"], 0)).toBe("val");
  });

  it("requireNumber validates", () => {
    expect(requireNumber("42", "task")).toBe(42);
    expect(() => requireNumber(undefined, "task")).toThrow();
    expect(() => requireNumber("abc", "task")).toThrow();
  });

  it("takeNumber finds and removes the numeric arg", () => {
    const args = ["view", "42", "--full"];
    expect(takeNumber(args, "task")).toBe(42);
    expect(args).toEqual(["view", "--full"]);
    expect(() => takeNumber(["view"], "task")).toThrow();
  });
});
