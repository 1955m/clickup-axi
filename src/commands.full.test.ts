import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { setFetchImpl, resetTokenCache, getV3 } from "./clickup.js";
import { resetReadonlyCache } from "./config.js";
import { checklistCommand } from "./commands/checklist.js";
import { goalCommand } from "./commands/goal.js";
import { webhookCommand } from "./commands/webhook.js";
import { memberCommand } from "./commands/member.js";
import { templateCommand } from "./commands/template.js";
import { dependencyCommand } from "./commands/dependency.js";
import { customFieldCommand } from "./commands/customField.js";
import { groupCommand } from "./commands/group.js";
import { chatCommand } from "./commands/chat.js";
import { docCommand } from "./commands/doc.js";
import { viewCommand } from "./commands/view.js";
import { taskCommand } from "./commands/task.js";
import { workspaceCommand } from "./commands/workspace.js";
import { resolvePath } from "./hierarchy.js";
import type { ClickupContext } from "./context.js";

const CTX: ClickupContext = { teamId: "1000000000", spaceId: "200000000000" };

function makeResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockOnce(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(makeResponse(status, body));
}

function urlOf(mock: ReturnType<typeof vi.fn>): string {
  return String(mock.mock.calls[0][0]);
}

function initOf(mock: ReturnType<typeof vi.fn>): RequestInit {
  return mock.mock.calls[0][1] as RequestInit;
}

beforeEach(() => {
  resetTokenCache();
  resetReadonlyCache();
  process.env["CLICKUP_API_TOKEN"] = "pk_test";
  setFetchImpl(null);
});
afterEach(() => {
  delete process.env["CLICKUP_API_TOKEN"];
  delete process.env["CLICKUP_AXI_READONLY"];
  resetReadonlyCache();
  setFetchImpl(null);
});

describe("checklist command", () => {
  it("help lists subcommands", async () => {
    expect(await checklistCommand(["--help"], CTX)).toContain("subcommands[7]");
  });

  it("list reads checklists from the task body (no dedicated GET)", async () => {
    const fetchMock = mockOnce({
      checklists: [
        {
          id: "c1",
          name: "Launch",
          resolved: 2,
          unresolved: 1,
          items: [{ id: "i1", name: "Notify", resolved: false }],
        },
      ],
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await checklistCommand(["list", "--task", "t1"], CTX);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock)).toContain("/task/t1");
    expect(out).toContain("Launch");
    expect(out).toContain("Notify");
  });

  it("create defaults to dry-run (no API call)", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await checklistCommand(["create", "--task", "t1", "--name", "Checks"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });

  it("create --execute POSTs /task/<id>/checklist", async () => {
    const fetchMock = mockOnce({ checklist: { id: "c1", name: "Checks" } });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await checklistCommand(
      ["create", "--task", "t1", "--name", "Checks", "--execute"],
      CTX,
    );
    expect(initOf(fetchMock).method).toBe("POST");
    expect(urlOf(fetchMock)).toContain("/task/t1/checklist");
    expect(out).toContain("c1");
  });

  it("item-delete requires --checklist to scope the path", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await expect(checklistCommand(["item-delete", "i1", "--execute"], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("goal command", () => {
  it("list GETs /team/<id>/goal", async () => {
    const fetchMock = mockOnce({
      goals: [{ id: "g1", name: "Q3", percent_completed: 40, key_results: [] }],
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await goalCommand(["list"], CTX);
    expect(urlOf(fetchMock)).toContain("/team/1000000000/goal");
    expect(out).toContain("Q3");
    expect(out).toContain("40%");
  });

  it("create dry-run (no call)", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await goalCommand(["create", "--name", "Q4", "--due", "1700000000000"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });

  it("key-result-create --execute POSTs /goal/<id>/key_result", async () => {
    const fetchMock = mockOnce({ key_result: { id: "kr1", name: "Uptime" } });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await goalCommand(
      ["key-result-create", "--goal", "g1", "--name", "Uptime", "--target", "99", "--execute"],
      CTX,
    );
    expect(initOf(fetchMock).method).toBe("POST");
    expect(urlOf(fetchMock)).toContain("/goal/g1/key_result");
    expect(out).toContain("kr1");
  });

  it("delete --execute DELETEs /goal/<id>", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await goalCommand(["delete", "g1", "--execute"], CTX);
    expect(initOf(fetchMock).method).toBe("DELETE");
    expect(urlOf(fetchMock)).toContain("/goal/g1");
  });
});

describe("webhook command", () => {
  it("list includes health status", async () => {
    const fetchMock = mockOnce({
      webhooks: [
        {
          id: "w1",
          endpoint: "https://x.com/h",
          events: ["taskCreated"],
          health: { status: "healthy" },
        },
      ],
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await webhookCommand(["list"], CTX);
    expect(urlOf(fetchMock)).toContain("/team/1000000000/webhook");
    expect(out).toContain("healthy");
  });

  it("create requires --endpoint and --event", async () => {
    await expect(webhookCommand(["create"], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      webhookCommand(["create", "--endpoint", "https://x.com/h"], CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("create --execute POSTs the scoped payload", async () => {
    const fetchMock = mockOnce({ webhook: { id: "w1", endpoint: "https://x.com/h" } });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await webhookCommand(
      [
        "create",
        "--endpoint",
        "https://x.com/h",
        "--event",
        "taskCreated",
        "--space",
        "200000000000",
        "--execute",
      ],
      CTX,
    );
    const body = JSON.parse(String(initOf(fetchMock).body));
    expect(body.events).toEqual(["taskCreated"]);
    expect(body.space_id).toBe(200000000000);
  });
});

describe("member command", () => {
  it("task members GETs /task/<id>/member", async () => {
    const fetchMock = mockOnce({
      members: [{ id: 1, username: "ding", email: "a@b.com", role: 3 }],
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await memberCommand(["task", "--task", "t1"], CTX);
    expect(urlOf(fetchMock)).toContain("/task/t1/member");
    expect(out).toContain("ding");
    expect(out).toContain("member");
  });

  it("guest-invite dry-run (no call)", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await memberCommand(["guest-invite", "--email", "p@x.com"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });

  it("guest-add requires a scope", async () => {
    await expect(memberCommand(["guest-add", "--guest", "1"], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("template command", () => {
  it("task-list GETs /team/<id>/taskTemplate", async () => {
    const fetchMock = mockOnce({ templates: ["t-1", "t-2"] });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await templateCommand(["task-list"], CTX);
    expect(urlOf(fetchMock)).toContain("/team/1000000000/taskTemplate");
    expect(out).toContain("t-1");
  });

  it("folder-create --execute POSTs /space/<id>/folder_template/<tid>", async () => {
    const fetchMock = mockOnce({ id: "f1" });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await templateCommand(
      [
        "folder-create",
        "--space",
        "200000000000",
        "--template",
        "t-9",
        "--name",
        "New",
        "--execute",
      ],
      CTX,
    );
    expect(urlOf(fetchMock)).toContain("/space/200000000000/folder_template/t-9");
  });
});

describe("dependency command", () => {
  it("add --depends-on dry-run", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await dependencyCommand(["add", "--task", "t1", "--depends-on", "t2"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });

  it("link --execute POSTs /task/<id>/link/<to>", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await dependencyCommand(["link", "--task", "t1", "--to", "t2", "--execute"], CTX);
    expect(initOf(fetchMock).method).toBe("POST");
    expect(urlOf(fetchMock)).toContain("/task/t1/link/t2");
  });

  it("unlink --execute DELETEs the link", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await dependencyCommand(["unlink", "--task", "t1", "--to", "t2", "--execute"], CTX);
    expect(initOf(fetchMock).method).toBe("DELETE");
  });
});

describe("custom-field command", () => {
  it("list --list GETs /list/<id>/field", async () => {
    const fetchMock = mockOnce({
      fields: [
        {
          id: "f1",
          name: "Product",
          type: "drop_down",
          value: null,
          type_config: { options: [{ id: "o1", name: "Backend" }] },
        },
      ],
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await customFieldCommand(["list", "--list", "123"], CTX);
    expect(urlOf(fetchMock)).toContain("/list/123/field");
    expect(out).toContain("Product");
  });

  it("set resolves field UUID by NAME (read-only GET) then dry-run preview", async () => {
    const fetchMock = mockOnce({
      fields: [
        {
          id: "066d",
          name: "Product",
          type: "drop_down",
          type_config: { options: [{ id: "o1", name: "Backend" }] },
        },
      ],
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await customFieldCommand(
      ["set", "t1", "--field", "Product=Backend", "--list", "123"],
      CTX,
    );
    // one read-only GET to resolve the field, no POST (dry-run)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(initOf(fetchMock).method).toBe("GET");
    expect(out).toContain("066d");
    expect(out).toContain("dry-run");
  });

  it("set --execute POSTs /task/<id>/field/<uuid> with coerced option id", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        fields: [
          {
            id: "066d",
            name: "Product",
            type: "drop_down",
            type_config: { options: [{ id: "o1", name: "Backend" }] },
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await customFieldCommand(
      ["set", "t1", "--field", "Product=Backend", "--list", "123", "--execute"],
      CTX,
    );
    const postUrl = String(fetchMock.mock.calls[1][0]);
    const postInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(postInit.method).toBe("POST");
    expect(postUrl).toContain("/task/t1/field/066d");
    expect(JSON.parse(String(postInit.body)).value).toBe("o1");
  });
});

describe("group command", () => {
  it("list GETs /group", async () => {
    const fetchMock = mockOnce({
      groups: [
        {
          id: "g1",
          name: "On-call",
          team_id: "1000000000",
          members: [{ id: 1, username: "ding" }],
        },
      ],
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await groupCommand(["list"], CTX);
    expect(urlOf(fetchMock)).toBe("https://api.clickup.com/api/v2/group");
    expect(out).toContain("On-call");
  });

  it("create dry-run requires --member", async () => {
    await expect(groupCommand(["create", "--name", "X"], CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await groupCommand(["create", "--name", "X", "--member", "1"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });
});

describe("chat command (v3)", () => {
  it("channel-list GETs the v3 channels path", async () => {
    const fetchMock = mockOnce({
      data: [{ id: "ch1", name: "general", type: "CHANNEL", visibility: "PUBLIC" }],
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await chatCommand(["channel-list"], CTX);
    expect(urlOf(fetchMock)).toContain(
      "https://api.clickup.com/api/v3/workspaces/1000000000/chat/channels",
    );
    expect(out).toContain("general");
  });

  it("message-send dry-run (no call, v3 marked)", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await chatCommand(["message-send", "--channel", "ch1", "--body", "hello"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });

  it("message-send --execute POSTs to v3 channels messages", async () => {
    const fetchMock = mockOnce({ data: { id: "m1" } });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await chatCommand(["message-send", "--channel", "ch1", "--body", "hi", "--execute"], CTX);
    expect(urlOf(fetchMock)).toContain("/chat/channels/ch1/messages");
    expect(initOf(fetchMock).method).toBe("POST");
  });
});

describe("doc command (v3)", () => {
  it("search GETs the v3 docs path", async () => {
    const fetchMock = mockOnce({
      docs: [{ id: "d1", name: "Runbook", date_created: 0, parent: { id: "s1", type: 4 } }],
      next_cursor: "cur1",
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await docCommand(["search", "--parent-type", "space", "--parent-id", "s1"], CTX);
    expect(urlOf(fetchMock)).toContain("https://api.clickup.com/api/v3/workspaces/1000000000/docs");
    expect(out).toContain("Runbook");
    expect(out).toContain("next_cursor: cur1");
  });

  it("create dry-run (no v3 POST)", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await docCommand(
      ["create", "--name", "R", "--parent-type", "space", "--parent-id", "s1"],
      CTX,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });

  it("page-view GETs v3 page and renders content", async () => {
    const fetchMock = mockOnce({
      id: "p1",
      name: "Step 1",
      content: "Do the thing",
      sub_title: "intro",
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await docCommand(["page-view", "p1", "--doc", "d1"], CTX);
    expect(urlOf(fetchMock)).toContain("/docs/d1/pages/p1");
    expect(out).toContain("Do the thing");
  });

  it("page-edit --execute PUTs v3 page", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await docCommand(["page-edit", "p1", "--doc", "d1", "--body", "new", "--execute"], CTX);
    expect(initOf(fetchMock).method).toBe("PUT");
    expect(urlOf(fetchMock)).toContain("/docs/d1/pages/p1");
  });
});

describe("view command (write support)", () => {
  it("create dry-run (no call)", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await viewCommand(
      ["create", "--name", "Sprint", "--type", "board", "--space", "200000000000"],
      CTX,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });

  it("create --execute POSTs /space/<id>/view", async () => {
    const fetchMock = mockOnce({ id: "v1", name: "Sprint", type: "board" });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await viewCommand(
      ["create", "--name", "Sprint", "--type", "board", "--space", "200000000000", "--execute"],
      CTX,
    );
    expect(urlOf(fetchMock)).toContain("/space/200000000000/view");
    expect(initOf(fetchMock).method).toBe("POST");
  });

  it("delete --execute DELETEs /view/<id>", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await viewCommand(["delete", "v1", "--execute"], CTX);
    expect(initOf(fetchMock).method).toBe("DELETE");
    expect(urlOf(fetchMock)).toContain("/view/v1");
  });
});

describe("task command (new subcommands)", () => {
  it("time-in-status GETs /task/<id>/time_in_status", async () => {
    const fetchMock = mockOnce({
      current_status: { status: "in progress", color: "blue", total_time: 3600000 },
      status_history: [],
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await taskCommand(["time-in-status", "t1"], CTX);
    expect(urlOf(fetchMock)).toContain("/task/t1/time_in_status");
    expect(out).toContain("in progress");
    expect(out).toContain("1h");
  });

  it("merge dry-run (no call)", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await taskCommand(["merge", "t1", "--task", "t2", "--task", "t3"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });

  it("merge --execute POSTs /task/<id>/merge with source_task_ids", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await taskCommand(["merge", "t1", "--task", "t2", "--task", "t3", "--execute"], CTX);
    expect(urlOf(fetchMock)).toContain("/task/t1/merge");
    expect(JSON.parse(String(initOf(fetchMock).body)).source_task_ids).toEqual(["t2", "t3"]);
  });

  it("add-to-list --execute POSTs /list/<id>/task/<id>", async () => {
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await taskCommand(["add-to-list", "t1", "--list", "l1", "--execute"], CTX);
    expect(urlOf(fetchMock)).toContain("/list/l1/task/t1");
    expect(initOf(fetchMock).method).toBe("POST");
  });
});

describe("workspace command (extended)", () => {
  it("seats renders member/guest seat counts", async () => {
    const fetchMock = mockOnce({
      members: { filled_members_seats: 3, total_member_seats: 10, empty_member_seats: 7 },
      guests: { filled_guests_seats: 1, total_guests_seats: 5, empty_guests_seats: 4 },
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await workspaceCommand(["seats"], CTX);
    expect(urlOf(fetchMock)).toContain("/team/1000000000/seats");
    expect(out).toContain("3/10");
  });

  it("plan renders plan name", async () => {
    const fetchMock = mockOnce({ plan_name: "Enterprise", plan_id: 4 });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await workspaceCommand(["plan"], CTX);
    expect(out).toContain("Enterprise");
  });

  it("shared renders shared hierarchy counts", async () => {
    const fetchMock = mockOnce({
      shared: { tasks: ["t1"], lists: [{ id: "l1", name: "Shared List" }], folders: [] },
    });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await workspaceCommand(["shared"], CTX);
    expect(out).toContain("Shared List");
    expect(out).toContain("tasks: 1");
  });
});

describe("hierarchy --path resolution", () => {
  it("resolves Space/Folder/List by name", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(makeResponse(200, { spaces: [{ id: "s1", name: "ExampleSpace" }] }));
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        folders: [{ id: "f1", name: "Backend", lists: [{ id: "l1", name: "Roadmap" }] }],
      }),
    );
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const rp = await resolvePath("ExampleSpace/Backend/Roadmap", "1000000000");
    expect(rp.spaceId).toBe("s1");
    expect(rp.folderId).toBe("f1");
    expect(rp.listId).toBe("l1");
    expect(rp.matched).toEqual(["ExampleSpace", "Backend", "Roadmap"]);
  });

  it("resolves Space/folderless-List when no folder matches", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(makeResponse(200, { spaces: [{ id: "s1", name: "ExampleSpace" }] }));
    fetchMock.mockResolvedValueOnce(makeResponse(200, { folders: [] }));
    fetchMock.mockResolvedValueOnce(makeResponse(200, { lists: [{ id: "l2", name: "Backlog" }] }));
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const rp = await resolvePath("ExampleSpace/Backlog", "1000000000");
    expect(rp.spaceId).toBe("s1");
    expect(rp.listId).toBe("l2");
  });

  it("throws VALIDATION_ERROR listing available names when a segment is unknown", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        spaces: [
          { id: "s1", name: "ExampleSpace" },
          { id: "s2", name: "Ops" },
        ],
      }),
    );
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await expect(resolvePath("Nope", "1000000000")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("readonly gate integration", () => {
  it("blocks a mutating --execute end-to-end (company account)", async () => {
    process.env["CLICKUP_AXI_READONLY"] = "1";
    resetReadonlyCache();
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await expect(goalCommand(["delete", "g1", "--execute"], CTX)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the dry-run preview under the readonly gate", async () => {
    process.env["CLICKUP_AXI_READONLY"] = "1";
    resetReadonlyCache();
    const fetchMock = mockOnce({});
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const out = await goalCommand(["delete", "g1"], CTX);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("dry-run");
  });
});

describe("v3 helpers", () => {
  it("getV3 targets the v3 base", async () => {
    const fetchMock = mockOnce({ data: { id: "x" } });
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await getV3("/workspaces/1/docs");
    expect(urlOf(fetchMock)).toContain("https://api.clickup.com/api/v3/workspaces/1/docs");
  });
});
