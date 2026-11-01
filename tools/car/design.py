import json
from pathlib import Path

TEAMS = Path("content/cars/teams.json")
TEAM = {}


def teams():
    return json.loads(TEAMS.read_text())


def use(team_id):
    TEAM.clear()
    TEAM.update(next(t for t in teams() if t["id"] == team_id))
    return TEAM


def param(name, default):
    return TEAM.get("design", {}).get(name, default)


def linear(colour):
    srgb = [int(colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
