import { describe, expect, it } from "vitest";
import {
  buildFieldIndex,
  resolveFieldValue,
  requireFieldId,
  coerceFieldValue,
  fieldNotFoundError,
  type ClickupField,
} from "./customFields.js";

const FIELDS: ClickupField[] = [
  {
    id: "field-1",
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
  {
    id: "field-2",
    name: "Tags",
    type: "labels",
    value: ["lbl-1", "lbl-3"],
    type_config: {
      options: [
        { id: "lbl-1", label: "alpha" },
        { id: "lbl-2", label: "beta" },
        { id: "lbl-3", label: "gamma" },
      ],
    },
  },
  { id: "field-3", name: "Owner", type: "users", value: [{ username: "alice" }] },
  { id: "field-4", name: "Risk", type: "text", value: "high" },
  { id: "field-5", name: "Empty", type: "text", value: null },
];

describe("buildFieldIndex", () => {
  it("keys fields by lowercased name", () => {
    const idx = buildFieldIndex(FIELDS);
    expect(idx.get("product")?.id).toBe("field-1");
    expect(idx.get("tags")?.id).toBe("field-2");
    expect(idx.get("owner")?.id).toBe("field-3");
    expect(idx.get("risk")?.id).toBe("field-4"); // storage key is lowercased
  });

  it("skips fields without a name", () => {
    const idx = buildFieldIndex([{ id: "x", name: "" }]);
    expect(idx.size).toBe(0);
  });
});

describe("resolveFieldValue", () => {
  it("decodes drop_down option id -> name", () => {
    const idx = buildFieldIndex(FIELDS);
    expect(resolveFieldValue(idx.get("product")!)).toBe("Frontend");
  });

  it("decodes labels option ids -> labels", () => {
    const idx = buildFieldIndex(FIELDS);
    expect(resolveFieldValue(idx.get("tags")!)).toEqual(["alpha", "gamma"]);
  });

  it("decodes users to usernames", () => {
    const idx = buildFieldIndex(FIELDS);
    expect(resolveFieldValue(idx.get("owner")!)).toEqual(["alice"]);
  });

  it("returns raw value for plain text", () => {
    const idx = buildFieldIndex(FIELDS);
    expect(resolveFieldValue(idx.get("risk")!)).toBe("high");
  });

  it("returns null for empty/null values", () => {
    const idx = buildFieldIndex(FIELDS);
    expect(resolveFieldValue(idx.get("empty")!)).toBeNull();
  });
});

describe("requireFieldId", () => {
  it("returns the id when the field exists", () => {
    const idx = buildFieldIndex(FIELDS);
    expect(requireFieldId(idx, "Product")).toBe("field-1");
    expect(requireFieldId(idx, "product")).toBe("field-1"); // case-insensitive
  });

  it("throws VALIDATION_ERROR when missing", () => {
    const idx = buildFieldIndex(FIELDS);
    try {
      requireFieldId(idx, "Nonexistent");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code: string }).code).toBe("VALIDATION_ERROR");
      expect((e as Error).message).toContain("Nonexistent");
    }
  });
});

describe("coerceFieldValue", () => {
  it("resolves drop_down option NAME -> id at write time", () => {
    const idx = buildFieldIndex(FIELDS);
    expect(coerceFieldValue(idx.get("product"), "Frontend")).toBe("opt-2");
    expect(coerceFieldValue(idx.get("product"), "Backend")).toBe("opt-1");
  });

  it("resolves labels option NAMES -> ids at write time", () => {
    const idx = buildFieldIndex(FIELDS);
    expect(coerceFieldValue(idx.get("tags"), ["alpha", "gamma"])).toEqual(["lbl-1", "lbl-3"]);
  });

  it("passes raw value through for unknown field types", () => {
    expect(coerceFieldValue(undefined, "anything")).toBe("anything");
    expect(coerceFieldValue(idx2(), "high")).toBe("high");
    function idx2() {
      return buildFieldIndex(FIELDS).get("risk");
    }
  });
});

describe("fieldNotFoundError", () => {
  it("has VALIDATION_ERROR code and lists available fields", () => {
    const err = fieldNotFoundError("X", ["a", "b"]);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("X");
    expect(err.suggestions.length).toBeGreaterThan(0);
  });
});
