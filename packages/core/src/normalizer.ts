import type { Sport, MarketType, BetSide, ParsedPick } from '@sports-engine/shared';
import { SPORT_ALIASES, MARKET_ALIASES } from '@sports-engine/shared';

// ─── Sport ────────────────────────────────────────────────────────────────────

/**
 * Resolve a raw sport string to a canonical Sport value.
 * Falls back to 'OTHER' when no alias matches.
 */
export function normalizeSport(raw: string): Sport {
  const key = raw.toLowerCase().trim();
  return SPORT_ALIASES[key] ?? 'OTHER';
}

// ─── Market Type ──────────────────────────────────────────────────────────────

/**
 * Resolve a raw market string to a canonical MarketType value.
 * Falls back to 'OTHER'.
 */
export function normalizeMarketType(raw: string): MarketType {
  const key = raw.toLowerCase().trim();
  return MARKET_ALIASES[key] ?? 'OTHER';
}

// ─── Player Name ──────────────────────────────────────────────────────────────

/** Title-case a player name and strip trailing punctuation. */
export function normalizePlayerName(raw: string): string {
  return raw
    .trim()
    .replace(/[.,;:!?]+$/, '')
    .split(/\s+/)
    .map((word) => {
      // Keep known suffixes lowercase in title-casing (Jr., Sr., III, II, IV)
      if (/^(jr|sr|ii|iii|iv|v)\.?$/i.test(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// ─── Line ─────────────────────────────────────────────────────────────────────

/**
 * Parse a line string into a number.
 * Handles: "o 22.5", "u 7.5", "over 28.5", "under 7", "+3.5", "-3.5", "22.5", "7+"
 */
export function normalizeLine(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();

  // Strip directional prefixes — we only want the number
  const withoutPrefix = cleaned
    .replace(/^(over|under|o|u)\s*/i, '')
    .replace(/[+]$/, '') // trailing + like "7+"
    .trim();

  const num = parseFloat(withoutPrefix);
  if (isNaN(num)) return null;
  return num;
}

// ─── Odds ─────────────────────────────────────────────────────────────────────

/**
 * Parse an American odds string into a signed integer.
 * Handles: "-110", "+150", "110" (assumed negative), "(110)" (parentheses = negative)
 */
export function normalizeOdds(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.trim();

  // Parenthesised odds e.g. "(110)" or "(-110)" = negative
  const parenMatch = cleaned.match(/^\((-?\d+)\)$/);
  if (parenMatch) {
    const n = parseInt(parenMatch[1], 10);
    return isNaN(n) ? null : -Math.abs(n);
  }

  // Standard format: optional sign + digits
  const match = cleaned.match(/^([+-]?\d{2,4})$/);
  if (!match) return null;

  const n = parseInt(match[1], 10);
  if (isNaN(n)) return null;

  // Bare positive numbers (no explicit sign) with 3+ digits are treated as negative
  // e.g. "110" → -110 (standard shorthand). Numbers with explicit sign are taken as-is.
  if (!cleaned.startsWith('+') && !cleaned.startsWith('-') && Math.abs(n) >= 100) {
    return -Math.abs(n);
  }

  return n;
}

// ─── Bet Side ─────────────────────────────────────────────────────────────────

/**
 * Resolve a raw directional string to a BetSide enum value.
 */
export function normalizeBetSide(raw: string): BetSide | null {
  const key = raw.toLowerCase().trim();
  const map: Record<string, BetSide> = {
    over: 'OVER',
    o: 'OVER',
    under: 'UNDER',
    u: 'UNDER',
    home: 'HOME',
    away: 'AWAY',
    yes: 'YES',
    no: 'NO',
    yrfi: 'YES',
    nrfi: 'NO',
  };
  return map[key] ?? null;
}

// ─── Label Builder ────────────────────────────────────────────────────────────

/**
 * Build a human-readable normalized label from partial pick data.
 * Examples:
 *   "Tatum Over 28.5 pts (-110)"
 *   "NRFI - NYY vs BOS"
 *   "Lakers ML (+120)"
 *   "Over 8.5 (NYY/BOS)"
 */
export function buildNormalizedLabel(pick: Partial<ParsedPick>): string {
  const parts: string[] = [];

  if (pick.playerName) {
    parts.push(pick.playerName);
  }

  if (pick.marketType === 'NRFI') {
    parts.push('NRFI');
    if (pick.gameLabel) parts.push(`- ${pick.gameLabel}`);
    else if (pick.teams && pick.teams.length >= 2) parts.push(`- ${pick.teams.join(' vs ')}`);
  } else if (pick.marketType === 'YRFI') {
    parts.push('YRFI');
    if (pick.gameLabel) parts.push(`- ${pick.gameLabel}`);
    else if (pick.teams && pick.teams.length >= 2) parts.push(`- ${pick.teams.join(' vs ')}`);
  } else if (pick.marketType === 'MONEYLINE') {
    const team = pick.betSide === 'HOME'
      ? pick.teams?.[0]
      : pick.betSide === 'AWAY'
      ? pick.teams?.[1]
      : pick.teams?.[0];
    if (team) parts.push(team);
    parts.push('ML');
  } else if (pick.marketType === 'SPREAD') {
    const team = pick.betSide === 'HOME' ? pick.teams?.[0] : pick.teams?.[1];
    if (team) parts.push(team);
    if (pick.line !== undefined) parts.push(`${pick.line > 0 ? '+' : ''}${pick.line}`);
  } else if (pick.marketType === 'TOTAL') {
    if (pick.betSide === 'OVER' || pick.betSide === 'UNDER') {
      parts.push(pick.betSide === 'OVER' ? 'Over' : 'Under');
    }
    if (pick.line !== undefined) parts.push(String(pick.line));
    if (pick.gameLabel) parts.push(`(${pick.gameLabel})`);
    else if (pick.teams && pick.teams.length >= 2) parts.push(`(${pick.teams.join('/')})`);
  } else if (pick.marketType === 'PLAYER_PROP') {
    if (pick.betSide === 'OVER') parts.push('Over');
    else if (pick.betSide === 'UNDER') parts.push('Under');
    if (pick.line !== undefined) parts.push(String(pick.line));
    if (pick.evidenceText) {
      // Try to extract prop type from evidence
      const propMatch = pick.evidenceText.match(/\b(pts|points|ks?|strikeouts?|hr|home\s*runs?|hits?|rbi|assists?|ast|reb(?:ounds?)?|pra)\b/i);
      if (propMatch) parts.push(propMatch[1].toLowerCase());
    }
  } else if (pick.marketType === 'PARLAY') {
    parts.push('Parlay');
    if (pick.odds !== undefined) {
      // nothing extra needed — odds suffix covers it
    }
  }

  // Odds suffix
  if (pick.odds !== undefined) {
    parts.push(`(${pick.odds > 0 ? '+' : ''}${pick.odds})`);
  }

  return parts.join(' ').trim() || 'Unknown Pick';
}
