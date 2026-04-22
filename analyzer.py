"""
analyzer.py — Vision OCR engine for bet slip images.

Sends scraped images to Claude Vision and extracts structured pick data.
Uses claude-haiku-4-5 + prompt caching to minimize token cost.
"""

import anthropic
import base64
import json
from pathlib import Path

# Cheapest vision-capable model: $1.00/$5.00 per 1M tokens
_VISION_MODEL = "claude-haiku-4-5"

# Cached on every call after the first — saves ~90% on system tokens
_SYSTEM = (
    "You are a sports betting data extractor. Your sole job is to parse bet "
    "slip images and return valid JSON. Output ONLY the JSON object — no "
    "commentary, no markdown fences, no explanation."
)

_EXTRACTION_PROMPT = """\
Extract every betting pick visible in this image. Return this exact JSON schema:

{
  "is_sgp": false,
  "picks": [
    {
      "player": "Player Name or Team",
      "prop_type": "Strikeouts|Walks|Hits|PAs|HRs|RBIs|Points|Rebounds|Assists|Moneyline|Spread|Total|etc",
      "line": 7.5,
      "odds": -110,
      "direction": "Over|Under|Moneyline|",
      "sport": "MLB|NBA|NFL|NCAAB|NCAAF|NHL|etc"
    }
  ]
}

Rules:
- Set is_sgp=true and list every leg if this is a Same Game Parlay.
- line must be numeric (float) or null if not present.
- odds must be American integer (e.g. -110, +150) or null if not visible.
- direction is empty string "" for Moneyline bets.
- Infer sport from context (team names, player names, prop types).
"""

_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _encode_image(path: str) -> tuple[str, str]:
    """Read image from disk and return (base64_data, media_type)."""
    p = Path(path)
    media_type = _MEDIA_TYPES.get(p.suffix.lower(), "image/jpeg")
    data = base64.standard_b64encode(p.read_bytes()).decode("utf-8")
    return data, media_type


def extract_picks_from_image(
    image_path: str,
    client: anthropic.Anthropic | None = None,
) -> dict:
    """
    Send a bet slip image to Claude Vision and return structured pick data.

    Returns:
        {
            "is_sgp": bool,
            "picks": [
                {
                    "player": str,
                    "prop_type": str,
                    "line": float | None,
                    "odds": int | None,
                    "direction": str,
                    "sport": str,
                }
            ]
        }

    Raises:
        json.JSONDecodeError: if the model returns malformed JSON.
        FileNotFoundError: if image_path does not exist.
    """
    if client is None:
        client = anthropic.Anthropic()

    image_data, media_type = _encode_image(image_path)

    response = client.messages.create(
        model=_VISION_MODEL,
        max_tokens=512,  # pick data is compact — cap output tokens
        system=[
            {
                "type": "text",
                "text": _SYSTEM,
                # Cache the system prompt; saves tokens on every subsequent call
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_data,
                        },
                    },
                    {"type": "text", "text": _EXTRACTION_PROMPT},
                ],
            }
        ],
    )

    raw = response.content[0].text.strip()

    # Strip any accidental markdown fences
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    return json.loads(raw)


def extract_picks_from_url(
    image_url: str,
    client: anthropic.Anthropic | None = None,
) -> dict:
    """
    Same as extract_picks_from_image but accepts a public image URL.
    Avoids downloading the image to disk — saves bandwidth.
    """
    if client is None:
        client = anthropic.Anthropic()

    response = client.messages.create(
        model=_VISION_MODEL,
        max_tokens=512,
        system=[
            {
                "type": "text",
                "text": _SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "url", "url": image_url},
                    },
                    {"type": "text", "text": _EXTRACTION_PROMPT},
                ],
            }
        ],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    return json.loads(raw)
