import { get, post, del } from "./clickup.js";

/**
 * Custom-field resolution by NAME — never hardcode field UUIDs.
 *
 * ClickUp custom-field IDs are volatile; the stable handle a human/agent
 * knows is the field NAME ("Product", "Approval State", "Risk"...). This
 * module mirrors the reference `mapping.py` patterns: `build_field_index()`
 * maps lowercased name -> field def, and `resolve_field_value()` coerces a
 * ClickUp custom-field object into a human-readable value (drop_down /
 * labels / users types are decoded against `type_config.options`).
 */

export interface ClickupFieldOption {
  id?: string | number;
  name?: string;
  label?: string;
  orderindex?: number | string;
  color?: string;
}

export interface ClickupField {
  id?: string;
  name?: string;
  type?: string;
  value?: unknown;
  date_created?: string | number;
  type_config?: {
    options?: ClickupFieldOption[];
    [key: string]: unknown;
  };
}

export type FieldIndex = Map<string, ClickupField>;

/** Map lowercased field name -> field definition (id, type, type_config). */
export function buildFieldIndex(fields: ClickupField[]): FieldIndex {
  const index = new Map<string, ClickupField>();
  for (const f of fields) {
    const name = (f.name ?? "").trim().toLowerCase();
    if (name) index.set(name, f);
  }
  return index;
}

/**
 * Turn a ClickUp task custom-field object into a human-readable value.
 * Decodes drop_down (option id -> name), labels (option ids -> label), and
 * users (id/email). Other types return the raw value.
 */
export function resolveFieldValue(field: ClickupField): unknown {
  const ftype = field.type;
  const value = field.value;
  if (value === null || value === undefined || value === "") return null;

  const options = field.type_config?.options ?? [];

  if (ftype === "drop_down") {
    for (const opt of options) {
      if (opt.id !== undefined && (opt.id === value || String(opt.id) === String(value))) {
        return opt.name ?? opt.id;
      }
      if (opt.orderindex !== undefined && String(opt.orderindex) === String(value)) {
        return opt.name ?? opt.orderindex;
      }
    }
    return value;
  }
  if (ftype === "labels") {
    const labelMap = new Map(
      options
        .filter((o) => o.id !== undefined)
        .map((o) => [String(o.id), o.label ?? o.name ?? String(o.id)]),
    );
    if (Array.isArray(value)) {
      return value.map((v) => labelMap.get(String(v)) ?? v);
    }
    return value;
  }
  if (ftype === "users") {
    if (Array.isArray(value)) {
      return value.map((u) =>
        u && typeof u === "object" ? (u.username ?? u.email ?? u.id ?? u) : u,
      );
    }
    return value;
  }
  return value;
}

/** Fetch and index the accessible custom fields for a list. */
export async function fetchListFieldIndex(listId: string): Promise<FieldIndex> {
  const body = await get<{ fields?: ClickupField[] }>(`/list/${listId}/field`);
  return buildFieldIndex(body?.fields ?? []);
}

/** Fetch and index the accessible custom fields for a space. */
export async function fetchSpaceFieldIndex(spaceId: string): Promise<FieldIndex> {
  const body = await get<{ fields?: ClickupField[] }>(`/space/${spaceId}/field`);
  return buildFieldIndex(body?.fields ?? []);
}

/** Fetch and index the custom fields created at the folder level. */
export async function fetchFolderFieldIndex(folderId: string): Promise<FieldIndex> {
  const body = await get<{ fields?: ClickupField[] }>(`/folder/${folderId}/field`);
  return buildFieldIndex(body?.fields ?? []);
}

/** Fetch and index the custom fields created at the workspace (team) level. */
export async function fetchTeamFieldIndex(teamId: string): Promise<FieldIndex> {
  const body = await get<{ fields?: ClickupField[] }>(`/team/${teamId}/field`);
  return buildFieldIndex(body?.fields ?? []);
}

/**
 * Set a custom-field value on a task, resolving the field UUID by NAME at
 * runtime (never hardcoded). `coerceFieldValue` resolves drop_down/labels
 * option names to ids at write time. Mirrors the task `--set-field` path.
 */
export async function setTaskCustomFieldByName(
  taskId: string,
  listId: string,
  name: string,
  rawValue: unknown,
): Promise<{ fieldId: string; coerced: unknown }> {
  const index = await fetchListFieldIndex(listId);
  const fieldDef = index.get(name.trim().toLowerCase());
  const fieldId = requireFieldId(index, name);
  const coerced = coerceFieldValue(fieldDef, rawValue);
  await post(`/task/${taskId}/field/${fieldId}`, { value: coerced });
  return { fieldId, coerced };
}

/** Remove a custom-field value from a task, resolving the field UUID by NAME. */
export async function removeTaskCustomFieldByName(
  taskId: string,
  listId: string,
  name: string,
): Promise<string> {
  const index = await fetchListFieldIndex(listId);
  const fieldId = requireFieldId(index, name);
  await del(`/task/${taskId}/field/${fieldId}`);
  return fieldId;
}

/**
 * Look up a custom field by name and return its id, throwing VALIDATION_ERROR
 * when not found so callers never hardcode a UUID.
 */
export function requireFieldId(index: FieldIndex, name: string): string {
  const field = index.get(name.trim().toLowerCase());
  if (!field || !field.id) {
    throw fieldNotFoundError(name, [...index.keys()]);
  }
  return field.id;
}

export function fieldNotFoundError(
  name: string,
  available: string[],
): Error & { code: string; suggestions: string[] } {
  const e = new Error(
    `Custom field "${name}" not found in this list/space. Available: ${available.sort().join(", ") || "none"}`,
  ) as Error & { code: string; suggestions: string[] };
  e.code = "VALIDATION_ERROR";
  e.suggestions = [
    "Field names resolve case-insensitively at runtime (never hardcode field UUIDs)",
    "Run `clickup-axi task custom-fields <id>` to list the accessible fields",
  ];
  return e;
}

/**
 * Coerce a typed value into the ClickUp custom-field wire format. For
 * drop_down/labels we resolve option NAME -> id at write time.
 */
export function coerceFieldValue(field: ClickupField | undefined, raw: unknown): unknown {
  if (!field) return raw;
  const ftype = field.type;
  const options = field.type_config?.options ?? [];
  if (ftype === "drop_down") {
    const opt = options.find((o) => (o.name ?? "").toLowerCase() === String(raw).toLowerCase());
    return opt?.id ?? raw;
  }
  if (ftype === "labels") {
    const wanted = Array.isArray(raw) ? raw : [raw];
    const ids = wanted.map((name) => {
      const opt = options.find(
        (o) => (o.label ?? o.name ?? "").toLowerCase() === String(name).toLowerCase(),
      );
      return opt?.id ?? name;
    });
    return ids;
  }
  return raw;
}
