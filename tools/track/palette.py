import json
from pathlib import Path

FLOOR_SHADE = 0.4


def shade(colour, amount):
    return "#" + "".join(f"{round(int(colour[i : i + 2], 16) * amount):02x}" for i in (1, 3, 5))


TEAMS = json.loads((Path(__file__).resolve().parents[2] / "content" / "cars" / "teams.json").read_text())
PALETTE = {
    **{f"team {i}": team["brand"] for i, team in enumerate(TEAMS)},
    **{f"team deep {i}": team["colours"]["primary"] for i, team in enumerate(TEAMS)},
    **{f"team floor {i}": shade(team["colours"]["primary"], FLOOR_SHADE) for i, team in enumerate(TEAMS)},
    "skin light": "#d9a784", "skin mid": "#a8744f", "skin dark": "#5f3d2a", "hair": "#1e1712", "black": "#0b0b0d",
    "dark": "#1a1c22", "white": "#e9e7e2", "grey": "#7d8088", "marshal": "#e8701a", "hi vis": "#c9d62a",
    "soft": "#d8232a", "medium": "#f2c418", "hard": "#ecebe6", "blanket": "#25272c", "chair": "#121317",
    "monitor": "#07090c", "rubber": "#101012", "jack": "#b9bdc4", "go": "#22c55e",
}
PALETTE_CELLS = 8
BRAND_ROWS = 12
BRAND_ASPECT = 8


def palette_uv(name):
    index = list(PALETTE).index(name)
    return ((index % PALETTE_CELLS + 0.5) / PALETTE_CELLS, 1 - (index // PALETTE_CELLS + 0.5) / PALETTE_CELLS)
