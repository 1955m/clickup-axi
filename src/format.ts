export interface FormatCountOpts {
  count: number;
  limit?: number;
  totalCount?: number | null;
  displayLimit?: number;
  apiLimitHit?: boolean;
}

/**
 * Shared count-line phrasing so list output stays consistent across commands.
 *   count: N
 *   count: N of T total
 *   count: N (showing first N)
 *   count: N+ (ClickUp API page limit reached)
 */
export function formatCountLine(opts: FormatCountOpts): string {
  const { count, limit, totalCount, apiLimitHit, displayLimit } = opts;
  if (apiLimitHit) {
    return `count: ${count}+ (more pages available — use --page to fetch the next page)`;
  }
  if (totalCount !== undefined && totalCount !== null) {
    return `count: ${count} of ${totalCount} total`;
  }
  if (displayLimit !== undefined && count > displayLimit) {
    return `count: ${count} (showing first ${displayLimit})`;
  }
  if (limit !== undefined && count === limit && count > 0) {
    return `count: ${count} (showing first ${count}; more pages may exist)`;
  }
  return `count: ${count}`;
}
