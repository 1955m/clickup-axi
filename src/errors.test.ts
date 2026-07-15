import { describe, expect, it } from "vitest";
import { mapClickupError } from "./errors.js";

describe("mapClickupError", () => {
  it("maps 401 to AUTH_REQUIRED", () => {
    const err = mapClickupError({ status: 401, body: { err: "Unauthorized" } });
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.message).toContain("token");
    expect(err.suggestions.length).toBeGreaterThan(0);
  });

  it("maps 403 to FORBIDDEN", () => {
    const err = mapClickupError({ status: 403, body: { err: "You do not have access" } });
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("permissions");
  });

  it("maps 429 to RATE_LIMITED", () => {
    const err = mapClickupError({ status: 429, body: "Too Many Requests" });
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toContain("rate limit");
    expect(err.suggestions.length).toBeGreaterThan(0);
  });

  it("maps 404 to NOT_FOUND with suggestions", () => {
    const err = mapClickupError({ status: 404, body: { err: "Task not found" } });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.suggestions.length).toBeGreaterThan(0);
  });

  it("maps 400 to VALIDATION_ERROR", () => {
    const err = mapClickupError({ status: 400, body: { err: "Invalid field" } });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("Invalid field");
  });

  it("maps 409 to VALIDATION_ERROR with conflict message", () => {
    const err = mapClickupError({ status: 409, body: { err: "Project already exists" } });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("Conflict");
  });

  it("maps 500 to UNKNOWN", () => {
    const err = mapClickupError({ status: 500, body: "Internal Server Error" });
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toContain("server error");
    expect(err.suggestions.length).toBeGreaterThan(0);
  });

  it("maps 422 to VALIDATION_ERROR (catch-all 4xx)", () => {
    const err = mapClickupError({ status: 422, body: { message: "Validation failed" } });
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("extracts message from err/error/message fields", () => {
    expect(mapClickupError({ status: 404, body: { err: "bad" } }).message).toBe("bad");
    expect(mapClickupError({ status: 404, body: { error: "bad" } }).message).toBe("bad");
    expect(mapClickupError({ status: 404, body: { message: "bad" } }).message).toBe("bad");
    expect(mapClickupError({ status: 404, body: "plain string" }).message).toBe("plain string");
  });

  it("falls back to HTTP status when no body text", () => {
    const err = mapClickupError({ status: 418, body: undefined });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("418");
  });
});