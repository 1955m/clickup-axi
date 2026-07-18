import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { setFetchImpl, get, request, resetTokenCache } from "./clickup.js";

function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("clickup request — 429 backoff", () => {
  beforeEach(() => {
    resetTokenCache();
    process.env["CLICKUP_API_TOKEN"] = "pk_test";
    setFetchImpl(null);
  });
  afterEach(() => {
    delete process.env["CLICKUP_API_TOKEN"];
    setFetchImpl(null);
    vi.restoreAllMocks();
  });

  it("retries on 429 and succeeds once a 2xx arrives", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        makeResponse(429, { err: "Too Many Requests" }, { "Retry-After": "0" }),
      )
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));
    setFetchImpl(fetchMock as unknown as typeof fetch);

    // Retry-After: 0 => sleep(0), so real timers resolve immediately.
    const resp = await request({ path: "/team/1/space" });
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws RATE_LIMITED after exhausting 6 attempts on persistent 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(429, "Too Many Requests", { "Retry-After": "0" }));
    setFetchImpl(fetchMock as unknown as typeof fetch);

    await expect(request({ path: "/team/1/space" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("maps a 401 response to AUTH_REQUIRED", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(401, { err: "Unauthorized" }));
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await expect(request({ path: "/task/nope" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps non-429 errors via mapClickupError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(404, { err: "Not found" }));
    setFetchImpl(fetchMock as unknown as typeof fetch);
    await expect(request({ path: "/task/nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("clickup get/post helpers", () => {
  beforeEach(() => {
    resetTokenCache();
    process.env["CLICKUP_API_TOKEN"] = "pk_test";
    setFetchImpl(null);
  });
  afterEach(() => {
    delete process.env["CLICKUP_API_TOKEN"];
    setFetchImpl(null);
    vi.restoreAllMocks();
  });

  it("get() builds query params and returns the parsed body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, { spaces: [{ id: "1", name: "ExampleSpace" }] }));
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const body = await get<{ spaces?: { id: string; name: string }[] }>("/team/1/space", {
      archived: "false",
    });
    expect(body.spaces?.[0].name).toBe("ExampleSpace");
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/team/1/space");
    expect(calledUrl).toContain("archived=false");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "pk_test" });
  });

  it("request() respects a non-JSON Content-Type and passes Buffer bodies raw", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, { id: "att1" }));
    setFetchImpl(fetchMock as unknown as typeof fetch);
    const buf = Buffer.from("rawbytes");
    const resp = await request<{ id: string }>({
      path: "/task/t1/attachments",
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x" },
      body: buf,
    });
    expect(resp.body.id).toBe("att1");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(buf); // NOT JSON.stringify'd
    expect(init.headers).toMatchObject({ "Content-Type": "multipart/form-data; boundary=x" });
  });
});
