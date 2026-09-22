import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAllowedCsvPath, assertUnchanged, createUpsertTarget, parseCsv, sha256, SUMMARY_COLUMNS, writeAtomic } from "../src/csv.js";

function summaryRow(tab: string, item: string) {
  return { brand: "Brand", year: "2026", month: "Sep", tab, line_order: "1", section: "Summary", item_type: "metric", item };
}

test("CSV parser round-trips BOM, commas, quotes, and newlines", () => {
  const raw = "\uFEFFbrand,item\nBrand,\"one, \"\"two\"\"\nand three\"\n";
  const parsed = parseCsv(raw);
  assert.equal(parsed.bom, true);
  assert.deepEqual(parsed.rows, [{ brand: "Brand", item: "one, \"two\"\nand three" }]);
});

test("preview target replaces only targeted blocks and detects a changed destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "zocialeye-csv-"));
  try {
    const output = join(root, "output");
    await mkdir(output);
    const path = join(output, "summary.csv");
    const raw = "\uFEFFbrand,year,month,tab,line_order,section,item_type,item\nBrand,2026,Sep,Overview,1,Summary,metric,old\nOther,2026,Sep,Overview,1,Summary,metric,keep\n";
    await writeFile(path, raw, "utf8");
    const approved = await assertAllowedCsvPath(path, [output]);
    const target = await createUpsertTarget({
      path: approved,
      columns: SUMMARY_COLUMNS,
      incomingRows: [summaryRow("Overview", "new")],
      removeExisting: (row) => row.brand === "Brand" && row.year === "2026" && row.month === "Sep" && row.tab === "Overview",
    });
    assert.equal(target.rowsReplaced, 1);
    assert.equal(target.rowsAdded, 1);
    assert.match(target.nextRaw, /Other,2026,Sep,Overview,1,Summary,metric,keep/);
    assert.match(target.nextRaw, /Brand,2026,Sep,Overview,1,Summary,metric,new/);
    await assertUnchanged(target);
    await writeFile(path, `${raw}Brand,2026,Sep,Overview,2,Summary,metric,tampered\n`, "utf8");
    await assert.rejects(assertUnchanged(target), /changed after preview/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic CSV commit creates a UTF-8 BOM CSV within an allowed root", async () => {
  const root = await mkdtemp(join(tmpdir(), "zocialeye-csv-"));
  try {
    const output = join(root, "output");
    await mkdir(output);
    const path = await assertAllowedCsvPath(join(output, "new-summary.csv"), [output]);
    const target = await createUpsertTarget({
      path,
      columns: SUMMARY_COLUMNS,
      incomingRows: [summaryRow("Overview", "created")],
      removeExisting: () => false,
    });
    await assertUnchanged(target);
    await writeAtomic(target);
    const written = await readFile(path, "utf8");
    assert.equal(sha256(written), target.nextSha256);
    assert.equal(parseCsv(written).rows[0].item, "created");
    await assert.rejects(assertAllowedCsvPath(join(root, "outside.csv"), [output]), /outside ZOCIALEYE_ALLOWED_OUTPUT_ROOTS/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
