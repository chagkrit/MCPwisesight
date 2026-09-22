export const PLATFORM_VALUES = ["Facebook", "X", "YouTube", "Instagram", "TikTok"] as const;
export const MONTH_VALUES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type Platform = (typeof PLATFORM_VALUES)[number];
export type Month = (typeof MONTH_VALUES)[number];
export type CsvRow = Record<string, string>;

export interface CollectionRequest {
  brand: string;
  year: string;
  month: Month;
  platforms: Platform[];
  summaryCsvPath: string;
  postsCsvPath: string;
}

export interface NormalizedRequest {
  brand: string;
  year: string;
  month: Month;
  platforms: Platform[];
  pageHeading: string;
  postedMonth: string;
}

export interface SourceCheck {
  availableRows: number | null;
  capturedUniqueRows: number;
  duplicatesRemoved: number;
  representativeRanksChecked: number[];
}

export interface CollectionData {
  request: NormalizedRequest;
  mode: string;
  summaryRows: CsvRow[];
  postRows: CsvRow[];
  sourceChecks: Record<Platform, SourceCheck>;
}

export interface AuthStatus {
  authenticated: boolean;
  url: string;
  message: string;
}

export interface CsvPlan {
  path: string;
  existed: boolean;
  expectedSha256: string | null;
  nextSha256: string;
  rowsAdded: number;
  rowsReplaced: number;
}

export interface StagedTarget extends CsvPlan {
  columns: string[];
  nextRaw: string;
}

export interface StagedCollection {
  version: 1;
  id: string;
  createdAt: string;
  expiresAt: string;
  collection: CollectionData;
  targets: {
    summary: StagedTarget;
    posts: StagedTarget;
  };
}

export interface CommitResult {
  collectionId: string;
  writtenAt: string;
  summary: Omit<CsvPlan, "expectedSha256" | "nextSha256">;
  posts: Omit<CsvPlan, "expectedSha256" | "nextSha256">;
}

export interface BrandScanGateway {
  authStatus(): Promise<AuthStatus>;
  collect(request: CollectionRequest): Promise<CollectionData>;
  close(): Promise<void>;
}
