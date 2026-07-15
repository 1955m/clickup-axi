import { describe, expect, it, beforeEach } from "vitest";
import { main, DESCRIPTION } from "./cli.js";
import { createSkillMarkdown } from "./skill.js";
import { setFetchImpl } from "./clickup.js";

function capture(): { chunks: string[]; stdout: { write: (c: string) => unknown } } {
  const chunks: string[] = [];
  return { chunks, stdout: { write: (c: string) => chunks.push(c) } };
}

describe("main (in-process, no network)", () => {
  beforeEach(() => {
    setFetchImpl(null);
  });

  it("prints version for -v", async () => {
    const out = capture();
    await main({ argv: ["-v"], stdout: out.stdout });
    expect(out.chunks.join("")).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints --version for --version", async () => {
    const out = capture();
    await main({ argv: ["--version"], stdout: out.stdout });
    expect(out.chunks.join("")).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints top-level help for --help", async () => {
    const out = capture();
    await main({ argv: ["--help"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("usage:");
    expect(text).toContain("commands[14]:");
    expect(text).toContain("--team");
    expect(text).toContain("--space");
  });

  it("rejects a leading flag with VALIDATION_ERROR", async () => {
    const out = capture();
    await main({ argv: ["--list", "123"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("after the command");
  });

  it("reports an unknown command", async () => {
    const out = capture();
    await main({ argv: ["bogus"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("Unknown command: bogus");
  });

  it("prints SKILL.md for --skill", async () => {
    const out = capture();
    await main({ argv: ["--skill"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("name: clickup-axi");
    expect(text).toContain("user-invocable: false");
    expect(text).toContain("## Commands");
    expect(text).toContain("commands[14]:");
  });

  it("renders the home dashboard header even on API failure", async () => {
    // Inject a fetch that always fails (no token / no network) — the home
    // command must still render the SDK header + team/space digest.
    setFetchImpl((async () => {
      throw new Error("no network");
    }) as unknown as typeof fetch);
    const out = capture();
    await main({ argv: [], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("bin:");
    expect(text).toContain(DESCRIPTION);
    expect(text).toContain("team:");
    expect(text).toContain("space:");
    expect(text).toContain("spaces:");
  });
});

describe("createSkillMarkdown", () => {
  it("includes frontmatter and the commands block", () => {
    const md = createSkillMarkdown();
    expect(md).toContain("---\nname: clickup-axi");
    expect(md).toContain("category: productivity");
    expect(md).toContain("commands[14]:");
    expect(md).toContain("npx -y clickup-axi");
  });

  it("documents the token discovery order", () => {
    const md = createSkillMarkdown();
    expect(md).toContain("CLICKUP_API_TOKEN");
    expect(md).toContain("AWS Secrets Manager");
    expect(md).toContain("--dry-run");
    expect(md).toContain("--execute");
  });
});