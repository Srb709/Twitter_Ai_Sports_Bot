export type Sport = 'MLB' | 'NBA' | 'NFL' | 'NCAAB' | 'NCAAF' | 'NHL' | 'MMA' | 'OTHER';
export type MarketType = 'MONEYLINE' | 'SPREAD' | 'TOTAL' | 'PLAYER_PROP' | 'NRFI' | 'YRFI' | 'PARLAY' | 'OTHER';
export type BetSide = 'OVER' | 'UNDER' | 'HOME' | 'AWAY' | 'YES' | 'NO';
export type TweetStatus = 'DRAFT' | 'APPROVED' | 'POSTED' | 'REJECTED';
export type TweetType =
  | 'MOST_BACKED'
  | 'PICK_OF_DAY'
  | 'NRFI_YRFI'
  | 'ENGAGEMENT_QUESTION'
  | 'POLL_STYLE'
  | 'PUBLIC_HEAVY'
  | 'FADE_ANGLE'
  | 'THREAD_STARTER';
export type OcrStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'SKIPPED';
export type ClusterType = 'SAME_PICK' | 'SAME_PLAYER' | 'SAME_GAME' | 'NRFI_YRFI' | 'FADE_TARGET';

/** Scraped post before DB save */
export interface RawPost {
  id: string;
  url: string;
  postKey: string;
  text: string;
  authorHandle: string;
  postedAt?: Date;
  mediaUrls: string[];
  screenshotPath?: string;
  rawJson?: unknown;
}

/** Extracted pick from text or OCR */
export interface ParsedPick {
  sport: Sport;
  league?: string;
  gameLabel?: string;
  teams: string[];
  playerName?: string;
  marketType: MarketType;
  betSide?: BetSide;
  line?: number;
  odds?: number;
  normalizedLabel: string;
  evidenceText: string;
  confidence: number;
}

/** Aggregated trending signal from clustering */
export interface ClusterSignal {
  id: string;
  label: string;
  sport?: string;
  clusterType: ClusterType;
  confidence: number;
  trendScore: number;
  supportCount: number;
  tags: string[];
  topPicks: ParsedPick[];
}

/** Input for AI tweet generation */
export interface TweetDraftInput {
  tweetType: TweetType;
  clusters: ClusterSignal[];
  picks: ParsedPick[];
  model: string;
}

/** Worker runtime configuration */
export interface WorkerConfig {
  scanIntervalMinutes: number;
  headless: boolean;
  maxScrolls: number;
  authStatePath: string;
  mediaDir: string;
  screenshotDir: string;
  aiProvider: 'openai' | 'anthropic';
  aiModel: string;
}

/** Summary returned after one account scan */
export interface ScanResult {
  accountUsername: string;
  newPosts: number;
  images: number;
  ocrDone: number;
  picks: number;
  errors: string[];
}
