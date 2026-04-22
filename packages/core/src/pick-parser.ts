import type { ParsedPick, Sport, MarketType, BetSide } from '@sports-engine/shared';
import { SPORT_ALIASES, PLAYER_PROP_ALIASES } from '@sports-engine/shared';
import {
  normalizeSport,
  normalizeMarketType,
  normalizePlayerName,
  normalizeLine,
  normalizeOdds,
  normalizeBetSide,
  buildNormalizedLabel,
} from './normalizer.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return the first regex match or null. */
function firstMatch(text: string, re: RegExp): RegExpMatchArray | null {
  return text.match(re);
}

/** Detect sport context from surrounding text. */
function detectSport(text: string): Sport {
  const lower = text.toLowerCase();
  for (const [alias, sport] of Object.entries(SPORT_ALIASES)) {
    if (lower.includes(alias)) return sport;
  }
  return 'OTHER';
}

/**
 * Extract American odds from text adjacent to a match position.
 * Looks for patterns like (-110), +150, -200 within 30 chars of the match.
 */
function extractNearbyOdds(text: string, offset: number): number | null {
  const window = text.slice(Math.max(0, offset - 5), Math.min(text.length, offset + 40));
  const match = window.match(/([+-]\d{2,4}|\(\d{2,4}\))/);
  if (!match) return null;
  return normalizeOdds(match[1]);
}

// ─── NRFI / YRFI ─────────────────────────────────────────────────────────────

/**
 * Detect a single NRFI or YRFI pick from the full post text.
 * Supports patterns like:
 *   "NRFI Yankees Red Sox"
 *   "YRFI Dodgers/Giants"
 *   "nrfi - NYY vs BOS"
 *   "taking the nrfi in the Cubs/Cardinals game"
 */
export function detectNrfiYrfi(text: string): ParsedPick | null {
  const nrfiRe = /\b(nrfi|yrfi)\b[\s\-:]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)?[\s\/vs.]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)?/i;
  const match = text.match(nrfiRe);
  if (!match) return null;

  const isYrfi = match[1].toUpperCase() === 'YRFI';
  const team1 = match[2]?.trim() ?? '';
  const team2 = match[3]?.trim() ?? '';
  const teams = [team1, team2].filter(Boolean);

  const oddsMatch = text.match(/([+-]\d{2,4}|\(\d{2,4}\))/);
  const odds = oddsMatch ? normalizeOdds(oddsMatch[1]) : undefined;

  const marketType: MarketType = isYrfi ? 'YRFI' : 'NRFI';
  const betSide: BetSide = isYrfi ? 'YES' : 'NO';
  const gameLabel = teams.length >= 2 ? `${teams[0]} vs ${teams[1]}` : teams[0];

  const pick: ParsedPick = {
    sport: 'MLB',
    teams,
    gameLabel,
    marketType,
    betSide,
    odds: odds ?? undefined,
    normalizedLabel: '',
    evidenceText: match[0],
    confidence: 0.85,
  };
  pick.normalizedLabel = buildNormalizedLabel(pick);
  return pick;
}

// ─── Player Props ─────────────────────────────────────────────────────────────

/**
 * Extract player prop picks from text.
 * Handles patterns like:
 *   "Tatum over 28.5 pts"      (NBA)
 *   "LeBron o 7.5 ast"         (NBA)
 *   "AD 12+ reb"               (NBA)
 *   "PRA 52.5"                 (NBA)
 *   "Cole 7+ Ks"               (MLB)
 *   "Acuña over 1.5 hits"      (MLB)
 *   "Judge HR"                 (MLB)
 *   "Mahomes o 275.5 yds"      (NFL)
 */
export function detectPlayerProp(text: string): ParsedPick[] {
  const picks: ParsedPick[] = [];

  // Pattern 1: "Name over/under/o/u line propType"
  // e.g. "Jayson Tatum over 28.5 pts", "Cole u 6.5 Ks"
  const propRe1 =
    /([A-Z][a-z]+(?:\s+[A-Z][a-zÀ-ÿ]+){0,2}(?:\s+Jr\.?|Sr\.?)?)[\s]+(?:to\s+)?([oO]ver|[uU]nder|[oO]|[uU])\s+([\d]+\.?[\d]*)\s*([A-Za-z+]+)/g;

  let m: RegExpExecArray | null;
  while ((m = propRe1.exec(text)) !== null) {
    const rawName = m[1];
    const rawSide = m[2];
    const rawLine = m[3];
    const rawProp = m[4];

    // Skip if prop alias isn't known
    const propKey = rawProp.toLowerCase().replace(/\+$/, '');
    if (!PLAYER_PROP_ALIASES[propKey] && !isPropKeyword(propKey)) continue;

    const playerName = normalizePlayerName(rawName);
    const line = normalizeLine(rawLine);
    const betSide = normalizeBetSide(rawSide);
    const sport = detectSport(text);
    const odds = extractNearbyOdds(text, (m.index ?? 0) + m[0].length);

    const pick: ParsedPick = {
      sport,
      teams: [],
      playerName,
      marketType: 'PLAYER_PROP',
      betSide: betSide ?? undefined,
      line: line ?? undefined,
      odds: odds ?? undefined,
      normalizedLabel: '',
      evidenceText: m[0],
      confidence: 0.8,
    };
    pick.normalizedLabel = buildNormalizedLabel(pick);
    picks.push(pick);
  }

  // Pattern 2: "Name line+ propType" — e.g. "AD 12+ reb", "Judge 1+ HR"
  const propRe2 = /([A-Z][a-z]+(?:\s+[A-Z][a-zÀ-ÿ]+){0,2})\s+([\d]+\.?[\d]*)\+\s*([A-Za-z]+)/g;
  while ((m = propRe2.exec(text)) !== null) {
    const rawName = m[1];
    const rawLine = m[2];
    const rawProp = m[3];

    const propKey = rawProp.toLowerCase();
    if (!PLAYER_PROP_ALIASES[propKey] && !isPropKeyword(propKey)) continue;

    const playerName = normalizePlayerName(rawName);
    const line = parseFloat(rawLine);
    const sport = detectSport(text);
    const odds = extractNearbyOdds(text, (m.index ?? 0) + m[0].length);

    const pick: ParsedPick = {
      sport,
      teams: [],
      playerName,
      marketType: 'PLAYER_PROP',
      betSide: 'OVER',
      line: isNaN(line) ? undefined : line,
      odds: odds ?? undefined,
      normalizedLabel: '',
      evidenceText: m[0],
      confidence: 0.75,
    };
    pick.normalizedLabel = buildNormalizedLabel(pick);
    picks.push(pick);
  }

  // Pattern 3: Home Run — "Judge HR", "Acuña to HR"
  const hrRe = /([A-Z][a-zÀ-ÿ]+(?:\s+[A-Z][a-zÀ-ÿ]+){0,2})\s+(?:to\s+)?HR\b/g;
  while ((m = hrRe.exec(text)) !== null) {
    const playerName = normalizePlayerName(m[1]);
    const odds = extractNearbyOdds(text, (m.index ?? 0) + m[0].length);

    const pick: ParsedPick = {
      sport: 'MLB',
      teams: [],
      playerName,
      marketType: 'PLAYER_PROP',
      betSide: 'OVER',
      line: 0.5,
      odds: odds ?? undefined,
      normalizedLabel: `${playerName} to HR`,
      evidenceText: m[0],
      confidence: 0.8,
    };
    picks.push(pick);
  }

  // Pattern 4: "PRA over/o line" — combined NBA stat
  const praRe = /\bPRA\s+([oO]ver|[uU]nder|[oO]|[uU])?\s*([\d]+\.?[\d]*)/g;
  while ((m = praRe.exec(text)) !== null) {
    const rawSide = m[1] ?? 'over';
    const rawLine = m[2];
    const line = parseFloat(rawLine);
    const betSide = normalizeBetSide(rawSide);
    const odds = extractNearbyOdds(text, (m.index ?? 0) + m[0].length);

    const pick: ParsedPick = {
      sport: 'NBA',
      teams: [],
      marketType: 'PLAYER_PROP',
      betSide: betSide ?? 'OVER',
      line: isNaN(line) ? undefined : line,
      odds: odds ?? undefined,
      normalizedLabel: `PRA ${betSide ?? 'Over'} ${rawLine}`,
      evidenceText: m[0],
      confidence: 0.7,
    };
    picks.push(pick);
  }

  return deduplicatePicks(picks);
}

// ─── Moneyline ────────────────────────────────────────────────────────────────

/**
 * Extract moneyline picks.
 * Handles:
 *   "Yankees ML (-150)"
 *   "Dodgers moneyline +120"
 *   "Lakers ML"
 *   "NYY -150"  (bare team + odds implies ML)
 */
export function detectMoneyline(text: string): ParsedPick[] {
  const picks: ParsedPick[] = [];

  // Pattern 1: "Team ML" with optional odds
  const mlRe = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:ML|moneyline)\b\s*([+-]\d{2,4}|\(\d{2,4}\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = mlRe.exec(text)) !== null) {
    const rawTeam = m[1].trim();
    const rawOdds = m[2];
    const odds = rawOdds ? normalizeOdds(rawOdds) : null;
    const sport = detectSport(text);

    const pick: ParsedPick = {
      sport,
      teams: [rawTeam],
      marketType: 'MONEYLINE',
      betSide: 'HOME',
      odds: odds ?? undefined,
      normalizedLabel: `${rawTeam} ML${odds ? ` (${odds > 0 ? '+' : ''}${odds})` : ''}`,
      evidenceText: m[0],
      confidence: 0.75,
    };
    picks.push(pick);
  }

  // Pattern 2: bare "Team -150" or "Team +250" (high-confidence odds = ML)
  const bareOddsRe = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+([+-]\d{3,4})\b/g;
  while ((m = bareOddsRe.exec(text)) !== null) {
    const rawTeam = m[1].trim();
    const odds = normalizeOdds(m[2]);
    if (odds === null) continue;
    // Avoid double-counting if already captured in pattern 1
    const alreadyCaptured = picks.some(
      (p) => p.teams[0]?.toLowerCase() === rawTeam.toLowerCase(),
    );
    if (alreadyCaptured) continue;

    const sport = detectSport(text);
    const pick: ParsedPick = {
      sport,
      teams: [rawTeam],
      marketType: 'MONEYLINE',
      betSide: 'HOME',
      odds: odds ?? undefined,
      normalizedLabel: `${rawTeam} ML (${odds > 0 ? '+' : ''}${odds})`,
      evidenceText: m[0],
      confidence: 0.6,
    };
    picks.push(pick);
  }

  return picks;
}

// ─── Spreads & Totals ─────────────────────────────────────────────────────────

/**
 * Extract game total (over/under) picks.
 * Handles: "o 8.5", "under 215.5", "total 48.5 o", "over/under 9"
 */
function detectGameTotal(text: string): ParsedPick[] {
  const picks: ParsedPick[] = [];
  // "over/under/o/u LINE" at the start of a phrase or after a separator
  const totalRe = /\b([Oo]ver|[Uu]nder|[Oo]|[Uu])\s+([\d]+\.?[\d]*)\b(?!\s*(?:pts|points|ks?|hr|hits?|rbi|ast|reb|pra|yrfi|nrfi))/g;
  let m: RegExpExecArray | null;
  while ((m = totalRe.exec(text)) !== null) {
    const rawSide = m[1];
    const rawLine = m[2];
    const betSide = normalizeBetSide(rawSide);
    const line = parseFloat(rawLine);
    if (isNaN(line)) continue;
    const sport = detectSport(text);
    const odds = extractNearbyOdds(text, (m.index ?? 0) + m[0].length);

    const pick: ParsedPick = {
      sport,
      teams: [],
      marketType: 'TOTAL',
      betSide: betSide ?? 'OVER',
      line,
      odds: odds ?? undefined,
      normalizedLabel: `${betSide ?? 'Over'} ${line}${odds ? ` (${odds > 0 ? '+' : ''}${odds})` : ''}`,
      evidenceText: m[0],
      confidence: 0.7,
    };
    picks.push(pick);
  }
  return picks;
}

/**
 * Detect spread picks.
 * Handles: "Lakers -3.5", "Chiefs +7", "Cowboys -6.5 (-110)"
 */
function detectSpread(text: string): ParsedPick[] {
  const picks: ParsedPick[] = [];
  const spreadRe = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+([+-][\d]+\.?[\d]*)\b(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = spreadRe.exec(text)) !== null) {
    const rawTeam = m[1].trim();
    const rawSpread = m[2];
    const spreadVal = parseFloat(rawSpread);
    if (isNaN(spreadVal)) continue;
    // Exclude large values that are clearly odds, not spreads (>25 is unrealistic spread)
    if (Math.abs(spreadVal) > 25) continue;

    const sport = detectSport(text);
    const odds = extractNearbyOdds(text, (m.index ?? 0) + m[0].length);

    const pick: ParsedPick = {
      sport,
      teams: [rawTeam],
      marketType: 'SPREAD',
      betSide: 'HOME',
      line: spreadVal,
      odds: odds ?? undefined,
      normalizedLabel: `${rawTeam} ${rawSpread}${odds ? ` (${odds > 0 ? '+' : ''}${odds})` : ''}`,
      evidenceText: m[0],
      confidence: 0.65,
    };
    picks.push(pick);
  }
  return picks;
}

// ─── Master Extractor ─────────────────────────────────────────────────────────

/**
 * Run all extractors on the input text and return a deduplicated list of picks.
 * Picks are ordered by confidence descending.
 */
export function extractPicksFromText(text: string): ParsedPick[] {
  if (!text || text.trim().length < 3) return [];

  const all: ParsedPick[] = [
    ...detectNrfiYrfi(text) ? [detectNrfiYrfi(text)!] : [],
    ...detectPlayerProp(text),
    ...detectMoneyline(text),
    ...detectGameTotal(text),
    ...detectSpread(text),
  ];

  return deduplicatePicks(all).sort((a, b) => b.confidence - a.confidence);
}

// ─── Market Label Normalizer ──────────────────────────────────────────────────

/**
 * Return a normalized display string for a market abbreviation.
 * e.g. "ml" → "Moneyline", "ou" → "Over/Under", "nrfi" → "NRFI"
 */
export function normalizeMarketLabel(raw: string): string {
  const key = raw.toLowerCase().trim();
  const labelMap: Record<string, string> = {
    ml: 'Moneyline',
    moneyline: 'Moneyline',
    nrfi: 'NRFI',
    yrfi: 'YRFI',
    ou: 'Over/Under',
    total: 'Over/Under',
    spread: 'Spread',
    ats: 'Spread',
    parlay: 'Parlay',
    sgp: 'Same-Game Parlay',
    prop: 'Player Prop',
    k: 'Strikeouts',
    ks: 'Strikeouts',
    pts: 'Points',
    pra: 'PRA',
    hr: 'Home Run',
    hits: 'Hits',
    rbi: 'RBIs',
    ast: 'Assists',
    reb: 'Rebounds',
  };
  return labelMap[key] ?? raw.toUpperCase();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Deduplicate picks by normalizedLabel (case-insensitive). */
function deduplicatePicks(picks: ParsedPick[]): ParsedPick[] {
  const seen = new Set<string>();
  return picks.filter((p) => {
    const key = p.normalizedLabel.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Check whether a word is a recognized prop keyword not in PLAYER_PROP_ALIASES. */
function isPropKeyword(word: string): boolean {
  const extras = new Set([
    'pts', 'points', 'ks', 'strikeouts', 'assists', 'rebounds',
    'hits', 'rbi', 'rbis', 'yards', 'yds', 'tds', 'receptions',
    'rec', 'goals', 'saves', 'blocks', 'blk', 'steals', 'stl',
    'minutes', 'min', 'sb', 'bases', 'tb', 'ip', 'er',
  ]);
  return extras.has(word.toLowerCase());
}
