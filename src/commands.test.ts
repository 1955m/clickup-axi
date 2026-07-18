import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { setFetchImpl, resetTokenCache } from "./clickup.js";
import { apiCommand } from "./commands/api.js";
import { taskCommand } from "./commands/task.js";
import { spaceCommand } from "./commands/space.js";
import type { ClickupContext } from "./context.js";

const CTX: ClickupContext = { teamId: "1000000000", spaceId: "200000000000" };

function makeResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api command", () => {
  beforeEach(() => {
    resetTokenCache();
    process.env["CLICKUP_API_TOKEN"] = "pk_test";
    setFetchImpl(null);
  });
  afterEach(() => {
    delete process.env["CLICKUP_API_TOKEN"];
    setFetchImpl(null);
  });

  it("returns help with --help", async () => {
    const out = await apiCommand(["--help"], CTX);
    expect(out).toContain("usage:");
    expect(out).toContain("GET");
  });

  it("issues a GET and renders the response as TOON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, { user: { id: 1, username: "ding" } }));
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await apiCommand(["GET", "user"], CTX);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe("https://api.clickup.com/api/v2/user");
    expect(out).toContain("api_response:");
    expect(out).toContain("ding");
  });

  it("strips noisy fields (avatar, profilePicture)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeResponse(200, { user: { id: 1, avatar: "x", profilePicture: "y", username: "ding" } }),
      );
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await apiCommand(["user"], CTX);
    expect(out).not.toContain("avatar");
    expect(out).not.toContain("profilePicture");
    expect(out).toContain("username");
  });
});

describe("task command", () => {
  beforeEach(() => {
    resetTokenCache();
    process.env["CLICKUP_API_TOKEN"] = "pk_test";
    setFetchImpl(null);
  });
  afterEach(() => {
    delete process.env["CLICKUP_API_TOKEN"];
    setFetchImpl(null);
  });

  it("returns help with no subcommand", async () => {
    const out = await taskCommand([], CTX);
    expect(out).toContain("usage:");
    expect(out).toContain("subcommands[12]");
  });

  it("requires --list for task list", async () => {
    await expect(taskCommand(["list"], CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lists tasks as a TOON table with a count line", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse(200, {
        tasks: [
          { id: "t1", name: "First", status: { status: "Open" }, creator: { username: "a" } },
          { id: "t2", name: "Second", status: { status: "Done" }, creator: { username: "b" } },
        ],
        last_page: true,
      }),
    );
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await taskCommand(["list", "--list", "123"], CTX);
    expect(out).toContain("count: 2");
    expect(out).toContain("tasks[2]");
    expect(out).toContain("First");
    expect(out).toContain("Second");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/list/123/task");
  });

  it("create defaults to dry-run and does NOT call the API", async () => {
    const fetchMock = vi.fn();
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await taskCommand(["create", "--name", "New", "--list", "123"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
    expect(out).toContain("New");
  });

  it("create with --execute POSTs to /list/<id>/task", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeResponse(200, { id: "new1", name: "New", url: "https://c.com/t/new1" }),
      );
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await taskCommand(["create", "--name", "New", "--list", "123", "--execute"], CTX);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/list/123/task");
    expect(out).toContain("created");
    expect(out).toContain("new1");
  });

  it("custom-fields resolves field values by type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse(200, {
        custom_fields: [
          {
            id: "f1",
            name: "Product",
            type: "drop_down",
            value: "opt-2",
            type_config: {
              options: [
                { id: "opt-1", name: "Backend" },
                { id: "opt-2", name: "Frontend" },
              ],
            },
          },
          { id: "f2", name: "Risk", type: "text", value: "high" },
        ],
      }),
    );
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await taskCommand(["custom-fields", "t1"], CTX);
    expect(out).toContain("Product");
    expect(out).toContain("Frontend");
    expect(out).toContain("high");
  });
});

describe("space command", () => {
  beforeEach(() => {
    resetTokenCache();
    process.env["CLICKUP_API_TOKEN"] = "pk_test";
    setFetchImpl(null);
  });
  afterEach(() => {
    delete process.env["CLICKUP_API_TOKEN"];
    setFetchImpl(null);
  });

  it("lists spaces as a TOON table", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse(200, {
        spaces: [
          { id: "200000000000", name: "ExampleSpace", private: false },
          { id: "2", name: "Other", private: true },
        ],
      }),
    );
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await spaceCommand(["list"], CTX);
    expect(out).toContain("count: 2");
    expect(out).toContain("ExampleSpace");
    expect(out).toContain("Other");
  });

  it("create dry-run preview (no API call)", async () => {
    const fetchMock = vi.fn();
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await spaceCommand(["create", "--name", "New Space"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
    expect(out).toContain("New Space");
  });
});
