import { homedir } from "node:os";
import { delimiter, isAbsolute, resolve } from "node:path";
import { McpUserError } from "./errors.js";

export interface AppConfig {
  appDataDir: string;
  chromeProfileDir: string;
  stagingDir: string;
  allowedOutputRoots: string[];
  headless: boolean;
  stageTtlMs: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new McpUserError("ZOCIALEYE_STAGE_TTL_MINUTES must be a positive integer.");
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appDataDir = resolve(env.ZOCIALEYE_APP_DATA_DIR ?? `${homedir()}/Library/Application Support/ZocialEye BrandScan MCP`);
  const configuredRoots = env.ZOCIALEYE_ALLOWED_OUTPUT_ROOTS?.split(delimiter).map((value) => value.trim()).filter(Boolean) ?? [];
  if (configuredRoots.length === 0) {
    throw new McpUserError("ZOCIALEYE_ALLOWED_OUTPUT_ROOTS must contain at least one absolute output directory.");
  }
  if (configuredRoots.some((root) => !isAbsolute(root))) {
    throw new McpUserError("Every ZOCIALEYE_ALLOWED_OUTPUT_ROOTS entry must be an absolute path.");
  }

  return {
    appDataDir,
    chromeProfileDir: resolve(env.ZOCIALEYE_CHROME_PROFILE_DIR ?? `${appDataDir}/chrome-profile`),
    stagingDir: resolve(env.ZOCIALEYE_STAGING_DIR ?? `${appDataDir}/staging`),
    allowedOutputRoots: [...new Set(configuredRoots.map((root) => resolve(root)))],
    headless: env.ZOCIALEYE_HEADLESS === "true",
    stageTtlMs: positiveInteger(env.ZOCIALEYE_STAGE_TTL_MINUTES, 30) * 60_000,
  };
}
