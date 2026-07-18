import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
    expect(text).toContain("commands[22]:");
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
    expect(text).toContain("commands[22]:");
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

  it("rejects an unknown flag on a subcommand with VALIDATION_ERROR (AXI P6)", async () => {
    // rejectUnknownFlags runs before any dependency call, so no fetch happens.
    const out = capture();
    await main({ argv: ["task", "list", "--bogus"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("unknown flag --bogus");
    expect(text).toContain("`task list`");
    // the self-correcting valid-flag list is folded in
    expect(text).toContain("--status");
  });

  it("allows --help on a subcommand even when not in its known-flag set", async () => {
    const out = capture();
    await main({ argv: ["task", "list", "--help"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("subcommands");
    expect(text).not.toContain("unknown flag");
  });
});

describe("createSkillMarkdown", () => {
  it("includes frontmatter and the commands block", () => {
    const md = createSkillMarkdown();
    expect(md).toContain("---\nname: clickup-axi");
    expect(md).toContain("category: productivity");
    expect(md).toContain("commands[22]:");
    expect(md).toContain("npx -y clickup-axi");
  });

  it("documents the token discovery order", async () => {
    const md = createSkillMarkdown();
    expect(md).toContain("CLICKUP_API_TOKEN");
    expect(md).toContain("COMPANY ClickUp account");
    // AWS Secrets Manager is documented as REMOVED (no longer a token source);
    // the aws invocation must not appear as a documented fallback.
    expect(md).toContain("REMOVED");
    expect(md).not.toContain("aws --profile example-space-staging");
    expect(md).not.toMatch(/mcpServers\.clickup\.env[^.]*>\s*AWS/);
    expect(md).toContain("--dry-run");
    expect(md).toContain("--execute");
  });

  it("committed SKILL.md matches createSkillMarkdown() (AXI P7: no skill drift)", () => {
    // Mirrors the CI docs:check gate (build:skill + git diff --exit-code --
    // skills/). If this fails, run `pnpm run build:skill` and commit the
    // regenerated skills/clickup-axi/SKILL.md.
    const here = fileURLToPath(import.meta.url);
    const dir = join(here, "..", "..", "skills", "clickup-axi");
    const committed = readFileSync(join(dir, "SKILL.md"), "utf8");
    expect(committed).toBe(`${createSkillMarkdown()}\n`);
  });
});
