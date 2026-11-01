PALETTE = {
    "team 0": "#e8e8ec", "team 1": "#d01c28", "team 2": "#1b4fa8", "team 3": "#f28a12", "team 4": "#117a4a",
    "team 5": "#6a2fb0", "team 6": "#10a5b8", "team 7": "#222a3a", "team 8": "#e6c21a", "team 9": "#d84f8c",
    "skin light": "#d9a784", "skin mid": "#a8744f", "skin dark": "#5f3d2a", "hair": "#1e1712", "black": "#0b0b0d",
    "dark": "#1a1c22", "white": "#e9e7e2", "grey": "#7d8088", "marshal": "#e8701a", "hi vis": "#c9d62a",
}
PALETTE_CELLS = 8


def palette_uv(name):
    index = list(PALETTE).index(name)
    return ((index % PALETTE_CELLS + 0.5) / PALETTE_CELLS, 1 - (index // PALETTE_CELLS + 0.5) / PALETTE_CELLS)
