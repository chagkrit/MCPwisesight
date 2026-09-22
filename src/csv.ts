import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { McpUserError } from "./errors.js";
import type { CsvPlan, CsvRow, StagedTarget } from "./types.js";

export const SUMMARY_COLUMNS = ["brand", "year", "month", "tab", "line_order", "section", "item_type", "item"] as const;
export const POST_COLUMNS = ["brand", "year", "month", "platform", "rank_in_month", "date", "message", "image_url", "channel", "engagement", "views", "reaction", "like", "comment", "share", "reply", "repost", "quote", "intention", "tag_friend", "type", "page", "row_on_page"] as const;

export interface ParsedCsv {
  bom: boolean;
  columns: string[];
  rows: CsvRow[];
}

interface ExistingCsv extends ParsedCsv {
  existed: boolean;
  raw: string;
  hash: string | null;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseCsv(raw: string): ParsedCsv {
  const bom = raw.startsWith("\uFEFF");
  const input = bom ? raw.slice(1) : raw;
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      if (field !== "") throw new McpUserError("Invalid CSV: a quote begins inside an unquoted field.");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else if (character === "\r") {
      if (input[index + 1] === "\n") continue;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new McpUserError("Invalid CSV: unterminated quoted field.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  if (records.length === 0) throw new McpUserError("CSV must include a header row.");

  const columns = records[0];
  if (new Set(columns).size !== columns.length || columns.some((column) => column === "")) {
    throw new McpUserError("CSV header contains a blank or duplicate column.");
  }
  const rows = records.slice(1).filter((record) => record.some((value) => value !== "")).map((record, index) => {
    if (record.length !== columns.length) {
      throw new McpUserError(`CSV row ${index + 2} has ${record.length} fields; expected ${columns.length}.`);
    }
    return Object.fromEntries(columns.map((column, columnIndex) => [column, record[columnIndex]]));
  });
  return { bom, columns, rows };
}

export function stringifyCsv(columns: readonly string[], rows: CsvRow[], bom: boolean): string {
  const escape = (value: string): string => /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const lines = [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column] ?? "")).join(","))];
  return `${bom ? "\uFEFF" : ""}${lines.join("\n")}\n`;
}

function exactColumns(actual: string[], expected: readonly string[], filePath: string): void {
  if (actual.length !== expected.length || actual.some((column, index) => column !== expected[index])) {
    throw new McpUserError(`${filePath} has an unsupported CSV header. Expected: ${expected.join(",")}`);
  }
}

async function readExisting(filePath: string, expectedColumns: readonly string[]): Promise<ExistingCsv> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = parseCsv(raw);
    exactColumns(parsed.columns, expectedColumns, filePath);
    return { ...parsed, existed: true, raw, hash: sha256(raw) };
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { bom: true, columns: [...expectedColumns], rows: [], existed: false, raw: "", hash: null };
    }
    throw error;
  }
}

function hasPathPrefix(candidate: string, root: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

async function canonicalRoot(root: string): Promise<string> {
  try {
    const info = await stat(root);
    if (!info.isDirectory()) throw new McpUserError(`Allowed output root is not a directory: ${root}`);
    return realpath(root);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new McpUserError(`Allowed output root does not exist: ${root}`);
    }
    throw error;
  }
}

async function canonicalCandidate(filePath: string): Promise<string> {
  const resolved = resolve(filePath);
  let current = resolved;
  const suffix: string[] = [];
  while (true) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new McpUserError(`CSV destination may not be a symbolic link: ${filePath}`);
      const canonical = await realpath(current);
      return suffix.reduceRight((parent, child) => join(parent, child), canonical);
    } catch (error: unknown) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      const parent = dirname(current);
      if (parent === current) throw new McpUserError(`Cannot resolve CSV destination: ${filePath}`);
      suffix.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

export async function assertAllowedCsvPath(filePath: string, allowedRoots: string[]): Promise<string> {
  if (!isAbsolute(filePath)) throw new McpUserError("CSV destination paths must be absolute.");
  if (extname(filePath).toLowerCase() !== ".csv") throw new McpUserError("CSV destination paths must end in .csv.");
  const candidate = await canonicalCandidate(filePath);
  const roots = await Promise.all(allowedRoots.map(canonicalRoot));
  if (!roots.some((root) => hasPathPrefix(candidate, root))) {
    throw new McpUserError(`CSV destination is outside ZOCIALEYE_ALLOWED_OUTPUT_ROOTS: ${filePath}`);
  }
  return candidate;
}

export async function createUpsertTarget(options: {
  path: string;
  columns: readonly string[];
  incomingRows: CsvRow[];
  removeExisting: (row: CsvRow) => boolean;
}): Promise<StagedTarget> {
  const existing = await readExisting(options.path, options.columns);
  const retained = existing.rows.filter((row) => !options.removeExisting(row));
  const replaced = existing.rows.length - retained.length;
  const nextRows = [...retained, ...options.incomingRows.map((row) => Object.fromEntries(options.columns.map((column) => [column, row[column] ?? ""])) )];
  const nextRaw = stringifyCsv(options.columns, nextRows, existing.bom);
  return {
    path: options.path,
    existed: existing.existed,
    expectedSha256: existing.hash,
    nextSha256: sha256(nextRaw),
    rowsAdded: options.incomingRows.length,
    rowsReplaced: replaced,
    columns: [...options.columns],
    nextRaw,
  };
}

export async function assertUnchanged(target: StagedTarget): Promise<void> {
  const current = await readExisting(target.path, target.columns);
  if (target.expectedSha256 === null) {
    if (current.existed) throw new McpUserError(`CSV destination changed after preview: ${target.path}`);
    return;
  }
  if (!current.existed || current.hash !== target.expectedSha256) {
    throw new McpUserError(`CSV destination changed after preview: ${target.path}`);
  }
}

export async function writeAtomic(target: StagedTarget): Promise<void> {
  await mkdir(dirname(target.path), { recursive: false }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") return;
    throw error;
  });
  const temporaryPath = join(dirname(target.path), `.${Date.now()}-${Math.random().toString(16).slice(2)}.zocialeye.tmp`);
  await writeFile(temporaryPath, target.nextRaw, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, target.path);
}

export function publicCsvPlan(target: StagedTarget): CsvPlan {
  const { nextRaw: _nextRaw, columns: _columns, ...plan } = target;
  return plan;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
