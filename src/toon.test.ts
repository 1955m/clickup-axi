import { describe, expect, it } from "vitest";
import {
  field,
  pluck,
  joinArray,
  lower,
  relativeTime,
  boolYesNo,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  extract,
} from "./toon.js";

const TASK = {
  id: "abc123",
  name: "Ship release",
  status: { status: "in progress", type: "custom" },
  creator: { username: "alice" },
  assignees: [{ username: "bob" }, { username: "carol" }],
  labels: ["bug", "ui"],
  date_created: "1752537600000",
  private: false,
};

describe("extract", () => {
  it("extracts field, pluck, lower, joinArray fields", () => {
    const out = extract(TASK, [
      field("id"),
      pluck("creator", "username", "creator"),
      lower("name"),
      joinArray("labels", null, "labels"),
    ]);
    expect(out).toEqual({
      id: "abc123",
      creator: "alice",
      name: "ship release",
      labels: "bug,ui",
    });
  });

  it("joinArray renders 'none' for empty arrays", () => {
    const out = extract({ ...TASK, labels: [] }, [joinArray("labels", null, "labels")]);
    expect(out.labels).toBe("none");
  });

  it("boolYesNo maps booleans", () => {
    expect(extract(TASK, [boolYesNo("private")]).private).toBe("no");
    expect(extract({ ...TASK, private: true }, [boolYesNo("private")]).private).toBe("yes");
  });

  it("custom extractor runs the fn", () => {
    const out = extract(TASK, [custom("status", (t) => `${(t as { status: { status: string } }).status.status}!`)]);
    expect(out.status).toBe("in progress!");
  });

  it("relativeTime formats a past timestamp", () => {
    const out = extract(TASK, [relativeTime("date_created", "created")]);
    expect(out.created).toMatch(/ago$|just now/);
  });
});

describe("renderers", () => {
  it("renderList produces a labeled TOON block", () => {
    const out = renderList("tasks", [TASK], [field("id"), field("name")]);
    expect(out).toContain("tasks[1]");
    expect(out).toContain("abc123");
    expect(out).toContain("Ship release");
  });

  it("renderDetail produces a single labeled object", () => {
    const out = renderDetail("task", TASK, [field("id")]);
    expect(out).toContain("task:");
    expect(out).toContain("id: abc123");
  });

  it("renderHelp formats a help[N] block", () => {
    expect(renderHelp(["do thing one", "do thing two"])).toBe("help[2]:\n  do thing one\n  do thing two");
    expect(renderHelp([])).toBe("");
  });

  it("renderOutput joins non-empty blocks with newlines", () => {
    expect(renderOutput(["a", undefined, "b"])).toBe("a\nb");
  });

  it("renderError includes code and suggestions", () => {
    const out = renderError("boom", "NOT_FOUND", ["retry"]);
    expect(out).toContain("error: boom");
    expect(out).toContain("code: NOT_FOUND");
    expect(out).toContain("help[1]");
  });
});