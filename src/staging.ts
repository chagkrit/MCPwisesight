import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpUserError } from "./errors.js";
import type { CollectionData, StagedCollection, StagedTarget } from "./types.js";

export class StageStore {
  constructor(private readonly directory: string, private readonly ttlMs: number) {}

  private pathFor(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new McpUserError("Invalid collectionId.");
    return join(this.directory, `${id}.json`);
  }

  async stage(collection: CollectionData, summary: StagedTarget, posts: StagedTarget): Promise<StagedCollection> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const now = Date.now();
    const record: StagedCollection = {
      version: 1,
      id: randomUUID(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      collection,
      targets: { summary, posts },
    };
    await writeFile(this.pathFor(record.id), JSON.stringify(record), { encoding: "utf8", mode: 0o600, flag: "wx" });
    return record;
  }

  async load(id: string): Promise<StagedCollection> {
    let parsed: StagedCollection;
    try {
      parsed = JSON.parse(await readFile(this.pathFor(id), "utf8")) as StagedCollection;
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        throw new McpUserError("The collection preview was not found. Run zocialeye_collect_preview again.");
      }
      throw new McpUserError("The staged collection is unreadable. Run zocialeye_collect_preview again.");
    }
    if (parsed.version !== 1 || parsed.id !== id || Date.parse(parsed.expiresAt) < Date.now()) {
      throw new McpUserError("The collection preview has expired. Run zocialeye_collect_preview again.");
    }
    return parsed;
  }

  async remove(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true });
  }
}
