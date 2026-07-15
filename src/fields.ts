import { AxiError } from "./errors.js";
import type { FieldDef } from "./toon.js";

export interface FieldSpec<T> {
  jsonKey: string;
  def: FieldDef<T>;
}

/**
 * Parse a --fields value (comma-separated field names), validate against the
 * available map, and return the extra FieldDefs.
 *
 * --fields lets agents opt into extra columns beyond the default schema.
 */
export function parseFields<T>(
  fieldsArg: string | undefined,
  available: Record<string, FieldSpec<T>>,
): { extraDefs: FieldDef<T>[] } {
  if (fieldsArg === undefined) {
    return { extraDefs: [] };
  }
  const requested = [
    ...new Set(
      fieldsArg
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
    ),
  ];
  const unknown = requested.filter((f) => !(f in available));
  if (unknown.length > 0) {
    const availableNames = Object.keys(available).sort().join(", ");
    throw new AxiError(
      `Unknown field(s): ${unknown.join(", ")}. Available: ${availableNames}`,
      "VALIDATION_ERROR",
    );
  }
  const extraDefs: FieldDef<T>[] = [];
  for (const name of requested) {
    extraDefs.push(available[name].def);
  }
  return { extraDefs };
}
