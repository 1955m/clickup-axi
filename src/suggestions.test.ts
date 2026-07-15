import { describe, expect, it } from "vitest";
import { getSuggestions } from "./suggestions.js";
import type { ClickupContext } from "./context.js";

const ctx: ClickupContext = { teamId: "9", spaceId: "90", folderId: "f1", listId: "l1" };

describe("getSuggestions", () => {
  it("returns a home hint", () => {
    const hints = getSuggestions({ domain: "home", action: "home" });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain("clickup-axi");
  });

  it("suggests view for a non-empty task list, with --list context", () => {
    const hints = getSuggestions({ domain: "task", action: "list", isEmpty: false, ctx });
    expect(hints.some((h) => h.includes("task view <id>"))).toBe(true);
    expect(hints.some((h) => h.includes("--list l1"))).toBe(true);
  });

  it("suggests create for an empty task list", () => {
    const hints = getSuggestions({ domain: "task", action: "list", isEmpty: true, ctx });
    expect(hints.some((h) => h.includes("task create"))).toBe(true);
  });

  it("folder view suggests listing child lists", () => {
    const hints = getSuggestions({ domain: "folder", action: "view", id: "f2", ctx });
    expect(hints.some((h) => h.includes("list list --folder f2"))).toBe(true);
  });

  it("space view suggests listing folders", () => {
    const hints = getSuggestions({ domain: "space", action: "view", id: "sp1", ctx });
    expect(hints.some((h) => h.includes("folder list --space sp1"))).toBe(true);
  });

  it("returns [] for api/setup domains", () => {
    expect(getSuggestions({ domain: "api", action: "anything" })).toEqual([]);
    expect(getSuggestions({ domain: "setup", action: "anything" })).toEqual([]);
  });

  it("returns [] when no entry matches", () => {
    expect(getSuggestions({ domain: "unknown-domain", action: "x" })).toEqual([]);
  });
});