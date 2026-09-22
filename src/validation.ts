import { MONTH_VALUES, PLATFORM_VALUES, type CollectionData, type CollectionRequest, type CsvRow, type Month, type Platform } from "./types.js";
import { McpUserError } from "./errors.js";

const summaryColumns = ["brand", "year", "month", "tab", "line_order", "section", "item_type", "item"];
const postColumns = ["brand", "year", "month", "platform", "rank_in_month", "date", "message", "image_url", "channel", "engagement", "views", "reaction", "like", "comment", "share", "reply", "repost", "quote", "intention", "tag_friend", "type", "page", "row_on_page"];

export function normalizeRequest(input: {
  brand: string;
  year: number;
  month: Month;
  platforms: Platform[];
  summaryCsvPath: string;
  postsCsvPath: string;
}): CollectionRequest {
  const brand = input.brand.trim();
  if (!brand) throw new McpUserError("brand must not be blank.");
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    throw new McpUserError("year must be a Gregorian year between 2000 and 2100.");
  }
  if (!MONTH_VALUES.includes(input.month)) throw new McpUserError("month must use a canonical abbreviation such as Sep.");
  const platforms = [...new Set(input.platforms)];
  if (platforms.length === 0 || platforms.some((platform) => !PLATFORM_VALUES.includes(platform))) {
    throw new McpUserError("platforms must include one or more supported canonical platforms.");
  }
  if (input.summaryCsvPath === input.postsCsvPath) throw new McpUserError("summaryCsvPath and postsCsvPath must be different files.");
  return { brand, year: String(input.year), month: input.month, platforms, summaryCsvPath: input.summaryCsvPath, postsCsvPath: input.postsCsvPath };
}

function isMonthDate(value: string, year: string, month: Month): boolean {
  const normalized = value.toLowerCase().replaceAll(".", "");
  const number = String(MONTH_VALUES.indexOf(month) + 1).padStart(2, "0");
  const longNames: Record<Month, string> = {
    Jan: "january", Feb: "february", Mar: "march", Apr: "april", May: "may", Jun: "june",
    Jul: "july", Aug: "august", Sep: "september", Oct: "october", Nov: "november", Dec: "december",
  };
  const monthPattern = new RegExp(`\\b${month.toLowerCase()}(?:${longNames[month].slice(month.length)})?\\b|\\b${number}[/-]${year}\\b|\\b${year}[/-]${number}\\b|\\b${year}-${number}-\\d{1,2}\\b|\\b\\d{1,2}-${number}-${year}\\b`);
  return normalized.includes(year) && monthPattern.test(normalized);
}

function requiredKeys(row: CsvRow, keys: string[], kind: string): void {
  for (const key of keys) {
    if (!(key in row)) throw new McpUserError(`${kind} row is missing ${key}.`);
  }
}

export function validateCollection(collection: CollectionData, request: CollectionRequest): void {
  if (collection.request.brand !== request.brand || collection.request.year !== request.year || collection.request.month !== request.month) {
    throw new McpUserError("The browser collection request does not match the requested brand, year, and month.");
  }
  const expectedPlatformSet = new Set(request.platforms);
  const summaryOrders = new Map<string, number>();
  for (const row of collection.summaryRows) {
    requiredKeys(row, summaryColumns, "Summary");
    if (row.brand !== request.brand || row.year !== request.year || row.month !== request.month) {
      throw new McpUserError("Summary row has a different brand, year, or month.");
    }
    const previous = summaryOrders.get(row.tab) ?? 0;
    if (Number(row.line_order) !== previous + 1) throw new McpUserError(`Summary line_order is not sequential for ${row.tab}.`);
    summaryOrders.set(row.tab, previous + 1);
  }
  const perPlatform = new Map<Platform, CsvRow[]>();
  for (const row of collection.postRows) {
    requiredKeys(row, postColumns, "Post");
    if (row.brand !== request.brand || row.year !== request.year || row.month !== request.month) {
      throw new McpUserError("Post row has a different brand, year, or month.");
    }
    const platform = row.platform as Platform;
    if (!expectedPlatformSet.has(platform)) throw new McpUserError(`Post row contains an unrequested platform: ${row.platform}`);
    if (!isMonthDate(row.date, request.year, request.month)) {
      throw new McpUserError(`Post date is not demonstrably in ${request.month} ${request.year}: ${row.date}`);
    }
    const rows = perPlatform.get(platform) ?? [];
    rows.push(row);
    perPlatform.set(platform, rows);
  }
  for (const platform of request.platforms) {
    const rows = perPlatform.get(platform) ?? [];
    if (rows.length > 100) throw new McpUserError(`${platform} exceeds the 100-post collection limit.`);
    const contentKeys = new Set<string>();
    rows.forEach((row, index) => {
      if (Number(row.rank_in_month) !== index + 1) throw new McpUserError(`${platform} rank_in_month is not sequential.`);
      const key = `${row.date}\u0000${row.message.trim().replace(/\s+/g, " ")}\u0000${row.engagement}\u0000${row.views}`;
      if (contentKeys.has(key)) throw new McpUserError(`${platform} contains a duplicate post content key.`);
      contentKeys.add(key);
    });
    const check = collection.sourceChecks[platform];
    if (!check || check.capturedUniqueRows !== rows.length) throw new McpUserError(`${platform} source-check count does not match collected posts.`);
  }
}
