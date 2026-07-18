import { readFileSync } from "node:fs";
import { AxiError } from "./errors.js";

function defaultSuggestions(label: string): string[] {
  return [`Use --body "..." for inline ${label}, or --body-file <path> for markdown from a file`];
}

function isMissingValue(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function isValueBoundary(arg: string | undefined, flags: string[]): boolean {
  if (arg === undefined) return false;
  return flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`));
}

interface FlagMatch {
  flag: string;
  value: string | undefined;
}

function takeFlagMatches(
  args: string[],
  flags: string[],
  valueBoundaryFlags: string[],
): FlagMatch[] {
  const matches: FlagMatch[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    let matched = false;
    for (const flag of flags) {
      const equalsPrefix = `${flag}=`;
      if (arg === flag) {
        const next = args[index + 1];
        const value =
          next !== undefined && !isValueBoundary(next, valueBoundaryFlags) ? next : undefined;
        const consumeCount = value === undefined ? 1 : 2;
        args.splice(index, consumeCount);
        index--;
        matches.push({ flag, value });
        matched = true;
        break;
      }
      if (arg.startsWith(equalsPrefix)) {
        args.splice(index, 1);
        index--;
        matches.push({ flag, value: arg.slice(equalsPrefix.length) });
        matched = true;
        break;
      }
    }
    if (matched) continue;
  }
  return matches;
}

function readBodyFile(flag: string, path: string, suggestions: string[]): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "UNKNOWN";
    if (code === "ENOENT") {
      throw new AxiError(`${flag} path not found: ${path}`, "VALIDATION_ERROR", suggestions);
    }
    if (code === "EISDIR") {
      throw new AxiError(
        `${flag} must point to a readable UTF-8 file, not a directory: ${path}`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    throw new AxiError(
      `Could not read ${flag} path: ${path} (${code})`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
}

export interface TakeBodyOptions {
  inlineFlags?: string[];
  fileFlags?: string[];
  valueBoundaryFlags?: string[];
  label?: string;
  suggestions?: string[];
  required?: boolean;
}

/** Resolve a body from --body/--body-file (or custom flags), reading the file when needed. */
export function takeBody(args: string[], options: TakeBodyOptions & { required: true }): string;
export function takeBody(args: string[], options?: TakeBodyOptions): string | undefined;
export function takeBody(args: string[], options: TakeBodyOptions = {}): string | undefined {
  const inlineFlags = options.inlineFlags ?? ["--body"];
  const fileFlags = options.fileFlags ?? ["--body-file"];
  const valueBoundaryFlags = [
    ...new Set([...inlineFlags, ...fileFlags, ...(options.valueBoundaryFlags ?? [])]),
  ];
  const label = options.label ?? "body";
  const suggestions = options.suggestions ?? defaultSuggestions(label);
  const inlineMatches = takeFlagMatches(args, inlineFlags, valueBoundaryFlags);
  const fileMatches = takeFlagMatches(args, fileFlags, valueBoundaryFlags);
  const matches = [...inlineMatches, ...fileMatches];
  if (matches.length === 0) {
    if (options.required) {
      throw new AxiError(
        `${inlineFlags[0]} or ${fileFlags[0]} is required`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    return undefined;
  }
  if (matches.length > 1) {
    throw new AxiError(
      `Use only one ${label} source: ${matches.map((m) => m.flag).join(", ")} were provided`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  const match = matches[0];
  const value = match.value;
  if (isMissingValue(value)) {
    const noun = fileFlags.includes(match.flag) ? "path" : "text";
    throw new AxiError(`${match.flag} requires ${noun}`, "VALIDATION_ERROR", suggestions);
  }
  const resolvedValue = value ?? "";
  if (fileFlags.includes(match.flag)) {
    return readBodyFile(match.flag, resolvedValue, suggestions);
  }
  return resolvedValue;
}

/** Collapse email-style quoted blocks and strip long URLs to reduce token cost. */
export function cleanBody(text: string): string {
  let s = text;
  // Strip markdown image embeds: ![alt](url) → [image: alt]
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_m, alt) => (alt ? `[image: ${alt}]` : "[image]"));
  // Strip long URLs (>80 chars) in markdown links: [text](longurl) → [text]
  s = s.replace(/\[([^\]]+)\]\(([^)]{80,})\)/g, "[$1]");
  // Strip standalone long URLs (>100 chars) not in markdown
  s = s.replace(/(?<!\()https?:\/\/\S{100,}/g, "[long URL removed]");
  // Collapse email-style quoted blocks (lines starting with >) to a summary
  s = s.replace(/(^|\n)(>\s?[^\n]*\n?){3,}/gm, "$1[quoted text removed]\n");
  return s;
}

/** Truncate a body field for display, applying cleanups only when truncation is needed. */
export function truncateBody(
  body: unknown,
  maxLen = 500,
  options: { originalHint?: string; fullHint?: string } = {},
): string {
  if (typeof body !== "string" || !body) return "";
  if (body.length <= maxLen) return body;
  const originalHint = options.originalHint ?? "use --full to see original";
  const fullHint = options.fullHint ?? "use --full to see complete body";
  const cleaned = cleanBody(body);
  if (cleaned.length <= maxLen) {
    if (cleaned !== body) {
      return `${cleaned}\n(cleaned, ${body.length} chars original - ${originalHint})`;
    }
    return cleaned;
  }
  return `${cleaned.slice(0, maxLen)}\n... (truncated, ${cleaned.length} chars total - ${fullHint})`;
}
