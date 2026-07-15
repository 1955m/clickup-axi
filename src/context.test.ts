import { describe, expect, it, beforeEach } from "vitest";
import { parseContextArgs, buildContext } from "./context.js";

describe("parseContextArgs", () => {
  it("strips --team/--space/--folder/--list in space form", () => {
    const r = parseContextArgs(["task", "list", "--team", "123", "--list", "456"]);
    expect(r.teamFlag).toBe("123");
    expect(r.listFlag).toBe("456");
    expect(r.spaceFlag).toBeUndefined();
    expect(r.folderFlag).toBeUndefined();
    expect(r.strippedArgs).toEqual(["task", "list"]);
  });

  it("strips equals form for all four flags", () => {
    const r = parseContextArgs(["task", "--team=111", "--space=222", "--folder=333", "--list=444", "list"]);
    expect(r).toMatchObject({ teamFlag: "111", spaceFlag: "222", folderFlag: "333", listFlag: "444" });
    expect(r.strippedArgs).toEqual(["task", "list"]);
  });

  it("leaves non-context flags and positionals untouched", () => {
    const r = parseContextArgs(["task", "view", "abc123", "--comments", "--full"]);
    expect(r.teamFlag).toBeUndefined();
    expect(r.strippedArgs).toEqual(["task", "view", "abc123", "--comments", "--full"]);
  });

  it("handles --help passthrough", () => {
    const r = parseContextArgs(["--help"]);
    expect(r.strippedArgs).toEqual(["--help"]);
  });
});

describe("buildContext", () => {
  beforeEach(() => {
    delete process.env["FM_CLICKUP_TEAM"];
    delete process.env["FM_CLICKUP_SPACE"];
    delete process.env["CLICKUP_TEAM_ID"];
    delete process.env["CLICKUP_SPACE_ID"];
  });

  it("applies defaults for team and space", () => {
    const ctx = buildContext(parseContextArgs([]));
    expect(ctx.teamId).toBe("1000000000");
    expect(ctx.spaceId).toBe("200000000000");
    expect(ctx.folderId).toBeUndefined();
    expect(ctx.listId).toBeUndefined();
  });

  it("honors explicit flags over defaults", () => {
    const ctx = buildContext(parseContextArgs(["--team", "999", "--space", "888", "--folder", "777", "--list", "666"]));
    expect(ctx).toEqual({ teamId: "999", spaceId: "888", folderId: "777", listId: "666" });
  });

  it("honors FM_CLICKUP_TEAM / FM_CLICKUP_SPACE env", () => {
    process.env["FM_CLICKUP_TEAM"] = "env-team";
    process.env["FM_CLICKUP_SPACE"] = "env-space";
    const ctx = buildContext(parseContextArgs([]));
    expect(ctx.teamId).toBe("env-team");
    expect(ctx.spaceId).toBe("env-space");
  });

  it("flags override env", () => {
    process.env["FM_CLICKUP_TEAM"] = "env-team";
    const ctx = buildContext(parseContextArgs(["--team", "flag-team"]));
    expect(ctx.teamId).toBe("flag-team");
  });
});