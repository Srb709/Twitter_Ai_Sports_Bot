"""
poster.py — @QuantSportsBrain tweet drafting engine.

Persona: Data-driven, professional, zero hype. No fire emojis.
MLB posts must reference the ABS (Automated Ball-Strike) system.

Uses claude-haiku-4-5 with a cached system prompt. Stale picks use a
template-based fallback that costs zero tokens.
"""

from __future__ import annotations

import anthropic

from logic import ConsensusAlert, SanityResult

_POSTER_MODEL = "claude-haiku-4-5"
MAX_TWEET_CHARS = 280

# Cached after the first call — the bulk of the input tokens for tweet drafts
_QUANT_PERSONA = """\
You are @QuantSportsBrain, a quantitative sports betting analyst on Twitter.

Tone rules (non-negotiable):
- Data-driven, precise, professional. Zero hype.
- No emojis except ✅ (valid line) and ⚠️ (line movement warning).
- Never use: 'fire', 'lock', 'easy money', 'guaranteed', 'fading', or superlatives.
- Every MLB tweet MUST include a concrete ABS (Automated Ball-Strike) system note.
- Format: data rationale → line/direction → odds → edge statement.
- Tweet MUST be ≤280 characters including hashtags.

Output ONLY the tweet text. No quotes, no commentary, no metadata.\
"""


# ---------------------------------------------------------------------------
# ABS system context injection
# ---------------------------------------------------------------------------


_ABS_NOTES: dict[str, str] = {
    "strikeouts": "ABS cutting ~1.1 borderline K/gm for pitchers; true K-rate compressing.",
    "walks": "ABS challenges converting fringe pitches to BB; walk-rate inflation present.",
    "hits": "ABS precision reduces weak-contact framing; suppresses soft-hit singles.",
    "batting average": "ABS removing low-strike framing depresses BA on groundball hitters.",
    "home runs": "ABS enforcing true strike zone; alters launch-angle batters' counts.",
    "earned run": "ABS expanding walks inflates ERA for pitch-to-contact starters.",
    "era": "ABS expanding walks inflates ERA for pitch-to-contact starters.",
}


def _abs_note(prop_type: str, player: str) -> str:
    """Return a one-line ABS system note relevant to the prop type."""
    key = prop_type.lower()
    for fragment, note in _ABS_NOTES.items():
        if fragment in key:
            return note
    return "ABS system reducing framing variance — cleaner true-talent signal on this line."


# ---------------------------------------------------------------------------
# Primary tweet drafter (uses Claude API)
# ---------------------------------------------------------------------------


def draft_tweet(
    alert: ConsensusAlert,
    sanity: SanityResult | None = None,
    client: anthropic.Anthropic | None = None,
) -> str:
    """
    Draft a tweet for a consensus alert using the Quant persona.

    Stale picks should use draft_stale_warning() instead to avoid API cost.

    Args:
        alert: A ConsensusAlert with at least 3 expert agreements.
        sanity: Optional SanityResult for market-odds context.
        client: Anthropic client (created from env var if None).

    Returns:
        Tweet string ≤ 280 characters.
    """
    if client is None:
        client = anthropic.Anthropic()

    pick = alert.sample_pick
    is_mlb = pick.sport.upper() == "MLB"
    abs_line = _abs_note(pick.prop_type, pick.player) if is_mlb else ""

    # Build compact context block — keep input tokens minimal
    odds_display = f"{pick.odds:+d}" if pick.odds is not None else "N/A"
    direction_display = f"{pick.direction} " if pick.direction else ""
    line_display = str(pick.line) if pick.line is not None else "ML"

    market_note = ""
    if sanity and sanity.market_odds is not None:
        market_note = f"Current market: {sanity.market_odds:+d}."

    context = (
        f"Pick: {pick.player} — {direction_display}{line_display} {pick.prop_type}\n"
        f"Sport: {pick.sport} | Scraped odds: {odds_display}\n"
        f"Consensus: {alert.count} analysts ({', '.join(alert.experts[:3])})\n"
        + (f"ABS context: {abs_line}\n" if abs_line else "")
        + (f"{market_note}\n" if market_note else "")
    )

    response = client.messages.create(
        model=_POSTER_MODEL,
        max_tokens=128,  # tweets are short — cap output aggressively
        system=[
            {
                "type": "text",
                "text": _QUANT_PERSONA,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": f"Draft a tweet for this pick:\n\n{context}",
            }
        ],
    )

    tweet = response.content[0].text.strip().strip('"').strip("'")

    # Hard-truncate as a safety net (should not trigger with max_tokens=128)
    if len(tweet) > MAX_TWEET_CHARS:
        tweet = tweet[: MAX_TWEET_CHARS - 1] + "…"

    return tweet


# ---------------------------------------------------------------------------
# Template-based stale warning (zero token cost)
# ---------------------------------------------------------------------------


def draft_stale_warning(alert: ConsensusAlert, sanity: SanityResult) -> str:
    """
    Generate a stale-pick warning tweet without any API call.

    Used when sanity.status == "STALE/NO VALUE" to avoid paying for Claude
    to write a tweet about a pick we don't want followers to take anyway.

    Returns:
        Tweet string ≤ 280 characters.
    """
    pick = alert.sample_pick
    direction = f"{pick.direction} " if pick.direction else ""
    line = str(pick.line) if pick.line is not None else "ML"
    scraped = f"{pick.odds:+d}" if pick.odds is not None else "N/A"
    market = f"{sanity.market_odds:+d}" if sanity.market_odds is not None else "N/A"
    moved = sanity.movement_cents or "?"

    tweet = (
        f"⚠️ PASS — {pick.player} {direction}{line} {pick.prop_type} "
        f"({pick.sport}): line moved {moved}¢ ({scraped} → {market}). "
        f"Value eroded. {alert.count} analysts saw original edge at {scraped}."
    )
    return tweet[:MAX_TWEET_CHARS]


# ---------------------------------------------------------------------------
# Batch helper
# ---------------------------------------------------------------------------


def draft_batch(
    alerts: list[tuple[ConsensusAlert, SanityResult | None]],
    client: anthropic.Anthropic | None = None,
) -> list[tuple[ConsensusAlert, str]]:
    """
    Draft tweets for a list of (alert, sanity) pairs.

    Stale picks automatically use the template path (no API call).
    Valid picks call Claude.

    Returns:
        List of (alert, tweet_text) tuples in the same order.
    """
    if client is None:
        client = anthropic.Anthropic()

    results: list[tuple[ConsensusAlert, str]] = []

    for alert, sanity in alerts:
        if sanity is not None and sanity.status == "STALE/NO VALUE":
            tweet = draft_stale_warning(alert, sanity)
        else:
            tweet = draft_tweet(alert, sanity, client=client)
        results.append((alert, tweet))

    return results
