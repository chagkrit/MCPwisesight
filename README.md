# Zocial Eye Brand Scan MCP

Local `stdio` MCP server for collecting data that the authenticated user can
already see in Zocial Eye Brand Scan. It drives an isolated, persistent Google
Chrome profile through the visible Brand Scan interface; it does not call
undocumented site APIs or store credentials, cookies, tokens, or session URLs.

## Tools

- `zocialeye_auth_status` opens/checks the dedicated Chrome profile and reports
  whether Brand Scan is ready. If login is needed, complete it yourself in the
  visible Chrome window and call the tool again.
- `zocialeye_collect_preview` receives an exact brand, Gregorian year/month,
  platforms, and the two CSV destinations. It captures the current Social
  Metric mode without changing it, validates source state, returns normalized
  JSON, and stages a non-mutating CSV upsert plan.
- `zocialeye_commit_csv` accepts only the `collectionId` returned by preview.
  It verifies that destinations have not changed and atomically writes the
  staged CSV replacements.

Each platform is capped at 100 unique Messages rows. The source is third-party
listening/benchmark data, not native reach, impressions, paid/organic, or
retention analytics.

## Configuration

The MCP server requires a non-empty allowlist of absolute directories:

```text
ZOCIALEYE_ALLOWED_OUTPUT_ROOTS=/absolute/allowed/output/directory
```

Use the platform path separator to allow more than one root. Optional settings:

```text
ZOCIALEYE_APP_DATA_DIR=/Users/you/Library/Application Support/ZocialEye BrandScan MCP
ZOCIALEYE_HEADLESS=false
ZOCIALEYE_STAGE_TTL_MINUTES=30
```

The default app-data directory is under macOS Application Support. It contains
the dedicated Chrome profile and short-lived preview staging data; never put it
in source control or share it.

## Local development

```bash
npm install
npm run check
npm test
npm run build
npm start
```

The server is intended to be registered as a local MCP command and not exposed
over HTTP.

## First use in Codex

1. Start a new Codex task (or restart Codex) so it loads `zocialeye_brandscan`.
2. Call `zocialeye_auth_status`. A dedicated Chrome window opens. Sign in to
   Zocial Eye yourself if it reports `authenticated: false`, then call the tool
   again.
3. Call `zocialeye_collect_preview` with exact `brand`, Gregorian `year` and
   `month`, canonical platform names, and two absolute CSV paths inside the
   configured allowlist.
4. Inspect the returned JSON, mode, source checks, and CSV plan. Only then call
   `zocialeye_commit_csv` using its `collectionId` before the preview expires.

On macOS, multiple allowlisted roots are separated with `:` in
`ZOCIALEYE_ALLOWED_OUTPUT_ROOTS`. Update the local Codex MCP configuration and
restart/start a new task after changing that setting.
