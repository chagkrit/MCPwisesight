import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StageStore } from "../src/staging.js";
import type { CollectionData, StagedTarget } from "../src/types.js";

const collection: CollectionData = {
  request: { brand: "Brand", year: "2026", month: "Sep", platforms: ["Facebook"], pageHeading: "ZOCIAL EYE Brand Scan", postedMonth: "Sep 2026" },
  mode: "as-displayed", summaryRows: [], postRows: [], sourceChecks: { Facebook: { availableRows: null, capturedUniqueRows: 0, duplicatesRemoved: 0, representativeRanksChecked: [] } },
};
const target: StagedTarget = { path: "/tmp/file.csv", existed: false, expectedSha256: null, nextSha256: "next", rowsAdded: 0, rowsReplaced: 0, columns: [], nextRaw: "" };

test("stage store persists only an expiring collection preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "zocialeye-stage-"));
  try {
    const store = new StageStore(root, 60_000);
    const staged = await store.stage(collection, target, target);
    assert.equal((await store.load(staged.id)).id, staged.id);
    await store.remove(staged.id);
    await assert.rejects(store.load(staged.id), /not found/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
