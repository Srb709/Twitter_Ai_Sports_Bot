"""
logic.py — Consensus Engine and Sanity Check.

No Claude API calls here — pure Python logic for odds comparison and
expert-consensus aggregation. Zero token cost.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

# Threshold: if a line has moved this many American-odds points against
# the bettor since the pick was scraped, flag it as stale.
STALE_THRESHOLD_CENTS: int = 15

# Minimum number of high-trust experts who must agree on the same pick
# before a ConsensusAlert is generated.
MIN_CONSENSUS_EXPERTS: int = 3

# Experts with trust_score below this floor are excluded from consensus.
MIN_TRUST_SCORE: float = 0.7


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class Pick:
    """A single betting pick scraped from one expert's post."""

    player: str
    prop_type: str
    line: Optional[float]
    odds: Optional[int]       # American odds, e.g. -110 or +150
    direction: str             # "Over", "Under", or "" for moneyline
    sport: str
    expert: str                # Twitter handle or source name
    source_image: str = ""     # URL or path to originating image
    trust_score: float = 1.0   # 0.0–1.0; set externally from expert ranking


@dataclass
class SanityResult:
    status: str                 # "VALID" | "STALE/NO VALUE" | "UNKNOWN"
    movement_cents: Optional[int]
    scraped_odds: Optional[int]
    market_odds: Optional[int]
    reason: str


@dataclass
class ConsensusAlert:
    pick_key: str               # canonical identifier for the pick
    experts: list[str]
    count: int
    avg_odds: float
    sample_pick: Pick           # representative pick for display


# ---------------------------------------------------------------------------
# Odds helpers
# ---------------------------------------------------------------------------


def american_to_implied_prob(odds: int) -> float:
    """Convert American odds to implied probability (0–1)."""
    if odds < 0:
        return abs(odds) / (abs(odds) + 100)
    return 100 / (odds + 100)


def movement_against_bettor(scraped_odds: int, market_odds: int) -> int:
    """
    Return cents the line has moved AGAINST the bettor.

    Positive  → line moved against bettor (worse value now).
    Negative  → line improved in bettor's favor.

    Works for both negative (favorite) and positive (underdog) American odds:
      scraped=-110, market=-130 → +20 (20¢ against bettor)
      scraped=-110, market=-90  → -20 (20¢ in bettor's favor)
      scraped=+120, market=+100 → +20 (20¢ against bettor)
      scraped=+120, market=+140 → -20 (improved)
    """
    return scraped_odds - market_odds


# ---------------------------------------------------------------------------
# Sanity Check
# ---------------------------------------------------------------------------


def sanity_check(pick: Pick, market_odds: int) -> SanityResult:
    """
    Compare scraped odds against current market odds.

    Args:
        pick: The scraped pick containing the original odds.
        market_odds: Current live odds from the books (American format).

    Returns:
        SanityResult with status VALID, STALE/NO VALUE, or UNKNOWN.
    """
    if pick.odds is None:
        return SanityResult(
            status="UNKNOWN",
            movement_cents=None,
            scraped_odds=None,
            market_odds=market_odds,
            reason="No scraped odds available for comparison.",
        )

    movement = movement_against_bettor(pick.odds, market_odds)

    if movement > STALE_THRESHOLD_CENTS:
        return SanityResult(
            status="STALE/NO VALUE",
            movement_cents=movement,
            scraped_odds=pick.odds,
            market_odds=market_odds,
            reason=(
                f"Line moved {movement}¢ against bettor "
                f"(scraped {pick.odds:+d} → current {market_odds:+d}). "
                f"Edge eroded beyond {STALE_THRESHOLD_CENTS}¢ threshold."
            ),
        )

    return SanityResult(
        status="VALID",
        movement_cents=movement,
        scraped_odds=pick.odds,
        market_odds=market_odds,
        reason=(
            f"Line movement {movement:+d}¢ within acceptable range "
            f"(threshold ±{STALE_THRESHOLD_CENTS}¢)."
        ),
    )


# ---------------------------------------------------------------------------
# Consensus Engine
# ---------------------------------------------------------------------------


def _canonical_key(pick: Pick) -> str:
    """
    Build a stable grouping key so identical picks from different experts
    map to the same bucket.
    """
    direction = (pick.direction or "").upper()
    prop = (pick.prop_type or "").lower().replace(" ", "_")
    line = str(pick.line) if pick.line is not None else "ml"
    return f"{pick.sport.upper()}|{pick.player.strip().lower()}|{prop}|{direction}|{line}"


def consensus_alert(
    picks: list[Pick],
    min_experts: int = MIN_CONSENSUS_EXPERTS,
    min_trust: float = MIN_TRUST_SCORE,
) -> list[ConsensusAlert]:
    """
    Scan a batch of picks from multiple experts.

    Generates a ConsensusAlert for every pick that at least `min_experts`
    high-trust (trust_score >= min_trust) unique experts have posted.

    Args:
        picks: All picks collected across sources.
        min_experts: Minimum number of unique experts required.
        min_trust: Minimum trust score to include an expert.

    Returns:
        List of ConsensusAlerts sorted by expert count descending.
    """
    groups: dict[str, list[Pick]] = defaultdict(list)

    for p in picks:
        if p.trust_score >= min_trust:
            groups[_canonical_key(p)].append(p)

    alerts: list[ConsensusAlert] = []

    for key, group in groups.items():
        # One entry per expert — dedup in case the same person posted twice
        seen: set[str] = set()
        unique: list[Pick] = []
        for p in group:
            if p.expert not in seen:
                seen.add(p.expert)
                unique.append(p)

        if len(unique) < min_experts:
            continue

        valid_odds = [p.odds for p in unique if p.odds is not None]
        avg_odds = round(sum(valid_odds) / len(valid_odds), 1) if valid_odds else 0.0

        alerts.append(
            ConsensusAlert(
                pick_key=key,
                experts=[p.expert for p in unique],
                count=len(unique),
                avg_odds=avg_odds,
                sample_pick=unique[0],
            )
        )

    return sorted(alerts, key=lambda a: a.count, reverse=True)


# ---------------------------------------------------------------------------
# Convenience: batch sanity-check a consensus alert
# ---------------------------------------------------------------------------


def validate_alert(
    alert: ConsensusAlert,
    market_odds_lookup: dict[str, int],
) -> tuple[ConsensusAlert, SanityResult]:
    """
    Run sanity_check against an alert using a market-odds lookup dict.

    Args:
        alert: A ConsensusAlert produced by consensus_alert().
        market_odds_lookup: Mapping of pick_key → current American odds.

    Returns:
        (alert, SanityResult) tuple.
    """
    market_odds = market_odds_lookup.get(alert.pick_key)
    if market_odds is None:
        result = SanityResult(
            status="UNKNOWN",
            movement_cents=None,
            scraped_odds=alert.sample_pick.odds,
            market_odds=None,
            reason="No current market odds found for this pick key.",
        )
    else:
        result = sanity_check(alert.sample_pick, market_odds)

    return alert, result
