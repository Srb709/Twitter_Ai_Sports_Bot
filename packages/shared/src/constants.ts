import type { Sport, MarketType, WorkerConfig } from './types.js';

/** Canonical sport lookup — keys are lowercase aliases */
export const SPORT_ALIASES: Record<string, Sport> = {
  nba: 'NBA',
  basketball: 'NBA',
  nfl: 'NFL',
  football: 'NFL',
  mlb: 'MLB',
  baseball: 'MLB',
  nhl: 'NHL',
  hockey: 'NHL',
  ncaab: 'NCAAB',
  'college basketball': 'NCAAB',
  ncaaf: 'NCAAF',
  'college football': 'NCAAF',
  mma: 'MMA',
  ufc: 'MMA',
  boxing: 'MMA',
};

/** Market type lookup — keys are lowercase aliases */
export const MARKET_ALIASES: Record<string, MarketType> = {
  ml: 'MONEYLINE',
  moneyline: 'MONEYLINE',
  'money line': 'MONEYLINE',
  nrfi: 'NRFI',
  yrfi: 'YRFI',
  k: 'PLAYER_PROP',
  ks: 'PLAYER_PROP',
  pts: 'PLAYER_PROP',
  points: 'PLAYER_PROP',
  pra: 'PLAYER_PROP',
  hruns: 'PLAYER_PROP',
  hr: 'PLAYER_PROP',
  hits: 'PLAYER_PROP',
  rbi: 'PLAYER_PROP',
  assists: 'PLAYER_PROP',
  ast: 'PLAYER_PROP',
  rebounds: 'PLAYER_PROP',
  reb: 'PLAYER_PROP',
  total: 'TOTAL',
  ou: 'TOTAL',
  'o/u': 'TOTAL',
  spread: 'SPREAD',
  ats: 'SPREAD',
  parlay: 'PARLAY',
  sgp: 'PARLAY',
  'same game parlay': 'PARLAY',
  'player prop': 'PLAYER_PROP',
  prop: 'PLAYER_PROP',
};

/** Human-readable display names for player prop shorthand */
export const PLAYER_PROP_ALIASES: Record<string, string> = {
  k: 'strikeouts',
  ks: 'strikeouts',
  pts: 'points',
  points: 'points',
  pra: 'points+rebounds+assists',
  reb: 'rebounds',
  rebounds: 'rebounds',
  ast: 'assists',
  assists: 'assists',
  hr: 'home runs',
  hruns: 'home runs',
  h: 'hits',
  hits: 'hits',
  rbi: 'RBIs',
  sb: 'stolen bases',
  tb: 'total bases',
  er: 'earned runs',
  ip: 'innings pitched',
  blk: 'blocks',
  stl: 'steals',
  tds: 'touchdowns',
  yds: 'yards',
  rec: 'receptions',
};

/** Sensible defaults for the scraper worker */
export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  scanIntervalMinutes: 10,
  headless: true,
  maxScrolls: 5,
  authStatePath: './auth/x-state.json',
  mediaDir: './data/media',
  screenshotDir: './data/screenshots',
  aiProvider: 'anthropic',
  aiModel: 'claude-haiku-4-5',
};

export const X_BASE_URL = 'https://x.com';
export const TWEET_CHAR_LIMIT = 280;
export const DEFAULT_SCAN_INTERVAL = 10;
