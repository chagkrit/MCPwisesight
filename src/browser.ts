import { chromium, type BrowserContext, type Frame, type Locator, type Page } from "playwright";
import { AuthenticationRequiredError, SourceStateError } from "./errors.js";
import { MONTH_VALUES, type AuthStatus, type BrandScanGateway, type CollectionData, type CollectionRequest, type CsvRow, type Month, type Platform, type SourceCheck } from "./types.js";

const BRAND_SCAN_URL = "https://zocialeye.wisesight.com/brandscan";
const TABLE_FIELDS: Record<string, keyof CsvRow> = {
  date: "date", "posted date": "date", message: "message", caption: "message", image: "image_url", thumbnail: "image_url",
  engagement: "engagement", view: "views", views: "views", reaction: "reaction", reactions: "reaction", like: "like", likes: "like",
  comment: "comment", comments: "comment", share: "share", shares: "share", reply: "reply", replies: "reply",
  repost: "repost", reposts: "repost", retweet: "repost", retweets: "repost", quote: "quote", quotes: "quote",
  intention: "intention", "tag friend": "tag_friend", "tag friends": "tag_friend", type: "type", "media type": "type",
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedHeader(value: string): string {
  return compact(value).toLowerCase().replace(/[：:]/g, "");
}

function supportedTabNames(platform: Platform): string[] {
  return platform === "X" ? ["X", "Twitter"] : [platform];
}

function requestedDateText(month: Month, year: string): string {
  return `${month} ${year}`;
}

async function visible(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible({ timeout: 500 });
  } catch {
    return false;
  }
}

async function getBrandScanFrame(page: Page): Promise<Frame> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const frame of page.frames()) {
      if (await visible(frame.getByText("Select Brands", { exact: true }).first())) return frame;
    }
    await page.waitForTimeout(250);
  }
  throw new AuthenticationRequiredError();
}

async function clickExact(frame: Frame, names: string[]): Promise<void> {
  for (const name of names) {
    const candidate = frame.getByText(name, { exact: true }).first();
    if (await visible(candidate)) {
      await candidate.scrollIntoViewIfNeeded();
      await candidate.click();
      return;
    }
  }
  throw new SourceStateError(`Could not find the expected control: ${names.join(" / ")}.`);
}

async function bodyText(frame: Frame): Promise<string> {
  return compact(await frame.locator("body").innerText());
}

async function waitForVisibleText(frame: Frame, value: string): Promise<void> {
  try {
    await frame.getByText(value, { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    throw new SourceStateError(`Expected source text did not appear: ${value}.`);
  }
}

export class PlaywrightBrandScanGateway implements BrandScanGateway {
  private context: BrowserContext | undefined;
  private page: Page | undefined;

  constructor(
    private readonly options: { profileDir: string; headless: boolean },
  ) {}

  private async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    this.context = await chromium.launchPersistentContext(this.options.profileDir, {
      channel: "chrome",
      headless: this.options.headless,
      viewport: { width: 1440, height: 1000 },
    });
    this.context.setDefaultTimeout(15_000);
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    return this.page;
  }

  private async openBrandScan(forceNavigation = false): Promise<Page> {
    const page = await this.getPage();
    if (forceNavigation || !page.url().startsWith(BRAND_SCAN_URL)) {
      await page.goto(BRAND_SCAN_URL, { waitUntil: "domcontentloaded" });
    }
    return page;
  }

  async authStatus(): Promise<AuthStatus> {
    const page = await this.openBrandScan();
    try {
      await getBrandScanFrame(page);
      return { authenticated: true, url: page.url(), message: "Brand Scan is ready in the dedicated Chrome profile." };
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return {
          authenticated: false,
          url: page.url(),
          message: "Chrome is open with the dedicated profile. Sign in to Zocial Eye there, then call zocialeye_auth_status again.",
        };
      }
      throw error;
    }
  }

  private async selectBrand(frame: Frame, brand: string): Promise<void> {
    const performance = frame.getByRole("button", { name: "View performance", exact: true }).first();
    if (await performance.isEnabled().catch(() => false)) {
      const clears = frame.getByRole("button", { name: "Clear", exact: true });
      for (let index = 0; index < await clears.count(); index += 1) {
        const clear = clears.nth(index);
        if (await clear.isEnabled().catch(() => false)) {
          await clear.click();
          await frame.page().waitForTimeout(250);
          break;
        }
      }
    }
    const label = frame.getByText(brand, { exact: true }).first();
    if (!(await visible(label))) throw new SourceStateError(`The authenticated account cannot see the requested brand: ${brand}.`);
    await label.scrollIntoViewIfNeeded();
    await label.click();
    if (!(await performance.isEnabled().catch(() => false))) {
      const card = label.locator("xpath=ancestor-or-self::*[.//input[@type='checkbox'] or @role='checkbox'][1]");
      const checkbox = card.locator("input[type='checkbox'], [role='checkbox']").first();
      if (await visible(checkbox)) await checkbox.click();
    }
    if (!(await performance.isEnabled().catch(() => false))) {
      throw new SourceStateError(`Selecting ${brand} did not enable View performance.`);
    }
    await performance.click();
    await waitForVisibleText(frame, "Social Metric");
  }

  private async selectSocialMetric(frame: Frame): Promise<void> {
    await clickExact(frame, ["Social Metric"]);
    await waitForVisibleText(frame, "Brand Summary");
  }

  private async setPostedMonth(frame: Frame, month: Month, year: string): Promise<void> {
    const expected = requestedDateText(month, year);
    if ((await bodyText(frame)).includes(expected)) return;
    const postedMonth = frame.getByText(/Posted month/i).first();
    if (!(await visible(postedMonth))) throw new SourceStateError("Could not find the Posted month control.");
    await postedMonth.click();
    const yearButton = frame.getByRole("button", { name: new RegExp(`^${year}$`) }).first();
    if (await visible(yearButton)) await yearButton.click();
    const monthButton = frame.getByRole("button", { name: new RegExp(`^${month}(?:[a-z]+)?$`, "i") }).last();
    if (await visible(monthButton)) {
      await monthButton.click();
    } else {
      await clickExact(frame, [month]);
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await bodyText(frame)).includes(expected)) return;
      await frame.page().waitForTimeout(250);
    }
    throw new SourceStateError(`Posted month did not update to ${expected}.`);
  }

  private async selectedMode(frame: Frame): Promise<string> {
    const active = await frame.locator("[aria-selected='true'], [data-state='active'], .active").allInnerTexts().catch(() => []);
    const mode = active.map(compact).find((value) => /^(Owned|Earned)$/i.test(value));
    return mode ?? "as-displayed";
  }

  private async summaryRows(frame: Frame, request: CollectionRequest, tab: string, headingCandidates: string | string[], mode?: string): Promise<CsvRow[]> {
    const lines = (await frame.locator("body").innerText()).split(/\r?\n/).map(compact).filter(Boolean);
    const candidates = Array.isArray(headingCandidates) ? headingCandidates : [headingCandidates];
    const start = lines.findIndex((line) => candidates.some((heading) => line.toLowerCase() === heading.toLowerCase()));
    if (start < 0) throw new SourceStateError(`Could not find ${candidates.join(" or ")} after selecting ${tab}.`);
    const heading = lines[start];
    const endOffset = lines.slice(start + 1).findIndex((line) => /^Messages$/i.test(line));
    const observed = lines.slice(start, endOffset < 0 ? Math.min(lines.length, start + 80) : start + endOffset + 1);
    const unique = observed.filter((line, index) => index === 0 || line !== observed[index - 1]);
    const rows: CsvRow[] = [{
      brand: request.brand, year: request.year, month: request.month, tab, line_order: "1", section: heading, item_type: "section_heading", item: heading,
    }];
    if (mode) rows.push({
      brand: request.brand, year: request.year, month: request.month, tab, line_order: String(rows.length + 1), section: heading, item_type: "source_scope", item: `Mode: ${mode}`,
    });
    for (const line of unique.slice(1)) {
      rows.push({
        brand: request.brand, year: request.year, month: request.month, tab, line_order: String(rows.length + 1), section: heading, item_type: "source_text", item: line,
      });
    }
    return rows;
  }

  private async messagesTable(frame: Frame): Promise<{ table: Locator; headers: string[]; rows: Locator }> {
    const messageHeading = frame.getByText("Messages", { exact: true }).first();
    if (await visible(messageHeading)) await messageHeading.click().catch(() => undefined);
    const candidates = frame.locator("table, [role='table'], [role='grid']");
    for (let attempt = 0; attempt < 40; attempt += 1) {
      for (let index = 0; index < await candidates.count(); index += 1) {
        const table = candidates.nth(index);
        const headerLocator = table.locator("thead th, [role='columnheader']");
        const headers = (await headerLocator.allInnerTexts()).map(compact).filter(Boolean);
        if (headers.some((header) => ["message", "caption"].includes(normalizedHeader(header)))) {
          const rows = (await table.locator("tbody tr").count()) > 0 ? table.locator("tbody tr") : table.locator("[role='row']");
          return { table, headers, rows };
        }
      }
      await frame.page().waitForTimeout(250);
    }
    throw new SourceStateError("Could not find a Messages table with Message or Caption headers.");
  }

  private async readCurrentMessagePage(tableInfo: { table: Locator; headers: string[]; rows: Locator }, request: CollectionRequest, platform: Platform, pageNumber: number): Promise<Array<{ row: CsvRow; key: string }>> {
    const indexByField = new Map<keyof CsvRow, number>();
    tableInfo.headers.forEach((header, index) => {
      const field = TABLE_FIELDS[normalizedHeader(header)];
      if (field) indexByField.set(field, index);
    });
    if (!indexByField.has("date") || !indexByField.has("message")) {
      throw new SourceStateError("Messages table no longer exposes Date and Message/Caption headers.");
    }
    const output: Array<{ row: CsvRow; key: string }> = [];
    for (let index = 0; index < await tableInfo.rows.count(); index += 1) {
      const sourceRow = tableInfo.rows.nth(index);
      const cells = (await sourceRow.locator("td, [role='cell']").allInnerTexts()).map(compact);
      if (cells.length === 0) continue;
      const valueFor = (field: keyof CsvRow): string => {
        const cellIndex = indexByField.get(field);
        return cellIndex === undefined ? "" : cells[cellIndex] ?? "";
      };
      const permalink = await sourceRow.locator("a[href]").first().getAttribute("href").catch(() => null);
      const imageUrl = await sourceRow.locator("img").first().getAttribute("src").catch(() => null);
      const row: CsvRow = {
        brand: request.brand, year: request.year, month: request.month, platform, rank_in_month: "0",
        date: valueFor("date"), message: valueFor("message"), image_url: valueFor("image_url") || imageUrl || "", channel: platform,
        engagement: valueFor("engagement"), views: valueFor("views"), reaction: valueFor("reaction"), like: valueFor("like"), comment: valueFor("comment"),
        share: valueFor("share"), reply: valueFor("reply"), repost: valueFor("repost"), quote: valueFor("quote"), intention: valueFor("intention"),
        tag_friend: valueFor("tag_friend"), type: valueFor("type"), page: String(pageNumber), row_on_page: String(index + 1),
      };
      const fallback = `${row.date}\u0000${row.message.replace(/\s+/g, " ")}\u0000${row.engagement}\u0000${row.views}`;
      output.push({ row, key: permalink ? `permalink:${permalink}` : `content:${fallback}` });
    }
    return output;
  }

  private async advancePage(frame: Frame, before: string): Promise<boolean> {
    const next = frame.getByRole("button", { name: /^(Next|Next page)$/i }).first();
    if (!(await visible(next)) || await next.isDisabled().catch(() => true)) return false;
    await next.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const table = await this.messagesTable(frame).catch(() => undefined);
      if (table && (await table.rows.first().innerText().catch(() => "")) !== before) return true;
      await frame.page().waitForTimeout(250);
    }
    throw new SourceStateError("Messages pagination did not update after Next.");
  }

  private async collectPlatform(frame: Frame, request: CollectionRequest, platform: Platform): Promise<{ summary: CsvRow[]; posts: CsvRow[]; check: SourceCheck }> {
    await clickExact(frame, supportedTabNames(platform));
    await frame.page().waitForTimeout(300);
    const summary = await this.summaryRows(frame, request, platform, ["Summary", "Brand Summary"]);
    const seen = new Set<string>();
    const posts: CsvRow[] = [];
    let duplicatesRemoved = 0;
    let pageNumber = 1;
    while (posts.length < 100) {
      const table = await this.messagesTable(frame);
      const before = await table.rows.first().innerText().catch(() => "");
      for (const source of await this.readCurrentMessagePage(table, request, platform, pageNumber)) {
        if (seen.has(source.key)) {
          duplicatesRemoved += 1;
          continue;
        }
        seen.add(source.key);
        source.row.rank_in_month = String(posts.length + 1);
        posts.push(source.row);
        if (posts.length === 100) break;
      }
      if (posts.length === 100 || !(await this.advancePage(frame, before))) break;
      pageNumber += 1;
    }
    const representativeRanks = posts.length === 0 ? [] : [...new Set([1, Math.ceil(posts.length / 2), posts.length])];
    return {
      summary,
      posts,
      check: { availableRows: null, capturedUniqueRows: posts.length, duplicatesRemoved, representativeRanksChecked: representativeRanks },
    };
  }

  async collect(request: CollectionRequest): Promise<CollectionData> {
    const ready = await this.authStatus();
    if (!ready.authenticated) throw new AuthenticationRequiredError();
    const page = await this.openBrandScan(true);
    const frame = await getBrandScanFrame(page);
    await this.selectBrand(frame, request.brand);
    await this.selectSocialMetric(frame);
    await this.setPostedMonth(frame, request.month, request.year);
    const visibleText = await bodyText(frame);
    if (!visibleText.includes(request.brand) || !visibleText.includes(requestedDateText(request.month, request.year))) {
      throw new SourceStateError("Brand or Posted month verification failed before capture.");
    }
    const mode = await this.selectedMode(frame);
    const summaryRows = await this.summaryRows(frame, request, "Overview", "Brand Summary", mode);
    const postRows: CsvRow[] = [];
    const sourceChecks = {} as Record<Platform, SourceCheck>;
    for (const platform of request.platforms) {
      const result = await this.collectPlatform(frame, request, platform);
      summaryRows.push(...result.summary);
      postRows.push(...result.posts);
      sourceChecks[platform] = result.check;
    }
    return {
      request: { brand: request.brand, year: request.year, month: request.month, platforms: request.platforms, pageHeading: "ZOCIAL EYE Brand Scan", postedMonth: requestedDateText(request.month, request.year) },
      mode,
      summaryRows,
      postRows,
      sourceChecks,
    };
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }
}
