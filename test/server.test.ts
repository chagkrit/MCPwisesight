import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseCsv } from "../src/csv.js";
import { createBrandScanServer } from "../src/server.js";
import type { BrandScanGateway, CollectionData } from "../src/types.js";

const collection: CollectionData = {
  request: { brand: "Brand", year: "2026", month: "Sep", platforms: ["Facebook"], pageHeading: "ZOCIAL EYE Brand Scan", postedMonth: "Sep 2026" },
  mode: "as-displayed",
  summaryRows: [
    { brand: "Brand", year: "2026", month: "Sep", tab: "Overview", line_order: "1", section: "Brand Summary", item_type: "section_heading", item: "Brand Summary" },
    { brand: "Brand", year: "2026", month: "Sep", tab: "Facebook", line_order: "1", section: "Summary", item_type: "section_heading", item: "Summary" },
  ],
  postRows: [{
    brand: "Brand", year: "2026", month: "Sep", platform: "Facebook", rank_in_month: "1", date: "06 Sep 2026", message: "Source message", image_url: "", channel: "Facebook",
    engagement: "2", views: "", reaction: "", like: "", comment: "", share: "", reply: "", repost: "", quote: "", intention: "", tag_friend: "", type: "", page: "1", row_on_page: "1",
  }],
  sourceChecks: { Facebook: { availableRows: null, capturedUniqueRows: 1, duplicatesRemoved: 0, representativeRanksChecked: [1] } },
};

class FakeGateway implements BrandScanGateway {
  async authStatus() { return { authenticated: true, url: "https://zocialeye.wisesight.com/brandscan", message: "ready" }; }
  async collect() { return collection; }
  async close() {}
}

test("MCP preview returns a collectionId without writing and commit writes staged CSVs", async () => {
  const root = await mkdtemp(join(tmpdir(), "zocialeye-server-"));
  try {
    const output = join(root, "output");
    await (await import("node:fs/promises")).mkdir(output);
    const app = createBrandScanServer({ appDataDir: root, chromeProfileDir: join(root, "profile"), stagingDir: join(root, "staging"), allowedOutputRoots: [output], headless: false, stageTtlMs: 60_000 }, new FakeGateway());
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await app.server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    const summaryPath = join(output, "summary.csv");
    const postsPath = join(output, "posts.csv");
    const preview = await client.callTool({ name: "zocialeye_collect_preview", arguments: { brand: "Brand", year: 2026, month: "Sep", platforms: ["Facebook"], summaryCsvPath: summaryPath, postsCsvPath: postsPath } });
    assert.equal(preview.isError, undefined);
    const previewBody = JSON.parse(preview.content[0].text) as { collectionId: string };
    await assert.rejects(readFile(summaryPath, "utf8"), /ENOENT/);
    const commit = await client.callTool({ name: "zocialeye_commit_csv", arguments: { collectionId: previewBody.collectionId } });
    assert.equal(commit.isError, undefined);
    assert.equal(parseCsv(await readFile(summaryPath, "utf8")).rows.length, 2);
    assert.equal(parseCsv(await readFile(postsPath, "utf8")).rows[0].message, "Source message");
    await client.close();
    await app.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
