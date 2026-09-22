import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PlaywrightBrandScanGateway } from "./browser.js";
import { assertAllowedCsvPath, assertUnchanged, createUpsertTarget, POST_COLUMNS, publicCsvPlan, SUMMARY_COLUMNS, writeAtomic } from "./csv.js";
import type { AppConfig } from "./config.js";
import { McpUserError } from "./errors.js";
import { StageStore } from "./staging.js";
import { MONTH_VALUES, PLATFORM_VALUES, type BrandScanGateway, type CollectionRequest } from "./types.js";
import { normalizeRequest, validateCollection } from "./validation.js";

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected MCP error.";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function makePreviewTargets(request: CollectionRequest, collection: Awaited<ReturnType<BrandScanGateway["collect"]>>) {
  const summaryTabs = new Set(collection.summaryRows.map((row) => row.tab));
  const platforms = new Set(request.platforms);
  return Promise.all([
    createUpsertTarget({
      path: request.summaryCsvPath,
      columns: SUMMARY_COLUMNS,
      incomingRows: collection.summaryRows,
      removeExisting: (row) => row.brand === request.brand && row.year === request.year && row.month === request.month && summaryTabs.has(row.tab),
    }),
    createUpsertTarget({
      path: request.postsCsvPath,
      columns: POST_COLUMNS,
      incomingRows: collection.postRows,
      removeExisting: (row) => row.brand === request.brand && row.year === request.year && row.month === request.month && platforms.has(row.platform as never),
    }),
  ]);
}

export function createBrandScanServer(config: AppConfig, gateway: BrandScanGateway = new PlaywrightBrandScanGateway({
  profileDir: config.chromeProfileDir,
  headless: config.headless,
})) {
  const stageStore = new StageStore(config.stagingDir, config.stageTtlMs);
  const server = new McpServer({ name: "zocialeye-brandscan-mcp", version: "0.1.0" });

  server.registerTool("zocialeye_auth_status", {
    title: "Zocial Eye authentication status",
    description: "Open/check the dedicated Chrome profile for Zocial Eye Brand Scan. If not ready, sign in manually in the visible Chrome window; credentials are never accepted by this MCP.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    try {
      return textResult(await gateway.authStatus());
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("zocialeye_collect_preview", {
    title: "Collect Zocial Eye Brand Scan preview",
    description: "Collect exactly one requested brand/month/platform set through visible Brand Scan UI, return normalized JSON, and stage a non-mutating CSV upsert. Social Metric scope is captured as currently displayed; this tool never switches Owned/Earned.",
    inputSchema: {
      brand: z.string().min(1),
      year: z.number().int(),
      month: z.enum(MONTH_VALUES),
      platforms: z.array(z.enum(PLATFORM_VALUES)).min(1).max(PLATFORM_VALUES.length),
      summaryCsvPath: z.string().min(1),
      postsCsvPath: z.string().min(1),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => {
    try {
      const normalized = normalizeRequest(input);
      const summaryCsvPath = await assertAllowedCsvPath(normalized.summaryCsvPath, config.allowedOutputRoots);
      const postsCsvPath = await assertAllowedCsvPath(normalized.postsCsvPath, config.allowedOutputRoots);
      const request = { ...normalized, summaryCsvPath, postsCsvPath };
      const collection = await gateway.collect(request);
      validateCollection(collection, request);
      const [summary, posts] = await makePreviewTargets(request, collection);
      const staged = await stageStore.stage(collection, summary, posts);
      return textResult({
        collectionId: staged.id,
        expiresAt: staged.expiresAt,
        collection: staged.collection,
        csvPlan: { summary: publicCsvPlan(summary), posts: publicCsvPlan(posts) },
        notice: "Preview did not write CSV files. Call zocialeye_commit_csv with collectionId to perform the validated, atomic per-file upsert.",
        dataScope: "Social Metric is third-party listening/benchmark data, not native reach, impressions, retention, follower growth, or paid/organic analytics.",
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("zocialeye_commit_csv", {
    title: "Commit a staged Zocial Eye CSV preview",
    description: "Write only a previously staged preview after rechecking both target hashes and output-root allowlist. This is the only CSV-writing tool.",
    inputSchema: { collectionId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ collectionId }) => {
    try {
      const staged = await stageStore.load(collectionId);
      const summaryPath = await assertAllowedCsvPath(staged.targets.summary.path, config.allowedOutputRoots);
      const postsPath = await assertAllowedCsvPath(staged.targets.posts.path, config.allowedOutputRoots);
      if (summaryPath !== staged.targets.summary.path || postsPath !== staged.targets.posts.path) {
        throw new McpUserError("A staged CSV target no longer resolves to its approved path. Run zocialeye_collect_preview again.");
      }
      await Promise.all([assertUnchanged(staged.targets.summary), assertUnchanged(staged.targets.posts)]);
      await writeAtomic(staged.targets.summary);
      await writeAtomic(staged.targets.posts);
      await stageStore.remove(collectionId);
      return textResult({
        collectionId,
        writtenAt: new Date().toISOString(),
        summary: publicCsvPlan(staged.targets.summary),
        posts: publicCsvPlan(staged.targets.posts),
        dataScope: "Social Metric is third-party listening/benchmark data, not native reach, impressions, retention, follower growth, or paid/organic analytics.",
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  return { server, close: () => gateway.close() };
}
