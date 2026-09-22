import assert from "node:assert/strict";
import test from "node:test";
import type { CollectionData, CollectionRequest, CsvRow } from "../src/types.js";
import { validateCollection } from "../src/validation.js";

const request: CollectionRequest = {
  brand: "Brand", year: "2026", month: "Sep", platforms: ["Facebook"], summaryCsvPath: "/tmp/summary.csv", postsCsvPath: "/tmp/posts.csv",
};

function post(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    brand: "Brand", year: "2026", month: "Sep", platform: "Facebook", rank_in_month: "1", date: "06 Sep 2026", message: "A message", image_url: "", channel: "Facebook",
    engagement: "12", views: "", reaction: "", like: "", comment: "", share: "", reply: "", repost: "", quote: "", intention: "", tag_friend: "", type: "", page: "1", row_on_page: "1", ...overrides,
  };
}

function collection(rows: CsvRow[]): CollectionData {
  return {
    request: { brand: "Brand", year: "2026", month: "Sep", platforms: ["Facebook"], pageHeading: "ZOCIAL EYE Brand Scan", postedMonth: "Sep 2026" },
    mode: "as-displayed",
    summaryRows: [{ brand: "Brand", year: "2026", month: "Sep", tab: "Overview", line_order: "1", section: "Brand Summary", item_type: "section_heading", item: "Brand Summary" }],
    postRows: rows,
    sourceChecks: { Facebook: { availableRows: null, capturedUniqueRows: rows.length, duplicatesRemoved: 0, representativeRanksChecked: rows.length ? [1] : [] } },
  };
}

test("collection validation accepts source-matched sequential records", () => {
  assert.doesNotThrow(() => validateCollection(collection([post()]), request));
});

test("collection validation rejects wrong dates and duplicate content", () => {
  assert.throws(() => validateCollection(collection([post({ date: "06 Oct 2026" })]), request), /not demonstrably/);
  const duplicate = post({ rank_in_month: "2" });
  assert.throws(() => validateCollection(collection([post(), duplicate]), request), /duplicate post content key/);
});
