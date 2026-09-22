#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createBrandScanServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = createBrandScanServer(config);
  const transport = new StdioServerTransport();
  await app.server.connect(transport);
  const shutdown = async () => {
    await app.close().catch(() => undefined);
    await app.server.close().catch(() => undefined);
  };
  process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  console.error("zocialeye-brandscan-mcp is running on stdio");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed to start zocialeye-brandscan-mcp.");
  process.exit(1);
});
