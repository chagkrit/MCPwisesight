import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

const execFile = promisify(execFileCallback);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const stageDir = await mkdtemp(resolve(tmpdir(), "zocialeye-brandscan-mcpb-"));
const bundleName = "zocialeye-brandscan-claude-desktop-0.1.0.mcpb";
const releaseDir = resolve(projectDir, "releases");
const bundlePath = resolve(releaseDir, bundleName);
const checksumPath = resolve(releaseDir, "SHA256SUMS.txt");
const mcpbCliPath = resolve(projectDir, "node_modules/@anthropic-ai/mcpb/dist/cli/cli.js");

async function run(command, args, cwd) {
  await execFile(command, args, {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

try {
  for (const file of ["manifest.json", "package.json", "package-lock.json"]) {
    await cp(resolve(projectDir, file), resolve(stageDir, file));
  }
  await cp(resolve(projectDir, "dist"), resolve(stageDir, "dist"), { recursive: true });

  // Playwright drives the user's installed Google Chrome, so skip install scripts
  // that would otherwise download an unnecessary browser binary into the bundle.
  const npmCommand = process.env.npm_execpath
    ? { command: process.execPath, args: [process.env.npm_execpath] }
    : { command: "npm", args: [] };
  await run(npmCommand.command, [...npmCommand.args, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], stageDir);

  await mkdir(releaseDir, { recursive: true });
  await rm(bundlePath, { force: true });
  await run(process.execPath, [mcpbCliPath, "pack", stageDir, bundlePath], projectDir);

  const bundle = await readFile(bundlePath);
  const digest = createHash("sha256").update(bundle).digest("hex");
  await writeFile(checksumPath, `${digest}  ${bundleName}\n`, "utf8");
  process.stdout.write(`Built ${bundlePath}\nSHA-256: ${digest}\n`);
} finally {
  await rm(stageDir, { recursive: true, force: true });
}
