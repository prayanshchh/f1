import numpy as np

ROW_DEPTH = 0.85
ROW_RISE = 0.42
FRONT_WALL = 2.0
MIN_ROWS = 4
MAX_ROWS = 44
AISLE_SPACING = 18.0
AISLE_WIDTH = 1.4
SEAT_SPACING = 0.56


def principal_axes(outline):
    centred = outline - outline.mean(axis=0)
    _, _, vectors = np.linalg.svd(centred, full_matrices=False)
    return vectors[0], vectors[1]


def layout(data):
    outline = np.array(data["outline"])
    _, short = principal_axes(outline)
    toward = np.asarray(data["facing"], float)
    facing = short if np.dot(short, toward) >= 0 else -short
    across = np.array([-facing[1], facing[0]])
    depth = outline @ facing
    length = outline @ across
    back, front, left, right = depth.min(), depth.max(), length.min(), length.max()
    rows = int(np.clip((front - back) / ROW_DEPTH, MIN_ROWS, MAX_ROWS))
    return {
        "facing": facing,
        "across": across,
        "back": back,
        "front": front,
        "left": left,
        "right": right,
        "rows": rows,
        "depth": (front - back) / rows,
        "base": data["base"],
    }


def seats(data):
    shape = layout(data)
    out = []
    aisles = np.arange(shape["left"] + AISLE_SPACING, shape["right"], AISLE_SPACING)
    for row in range(shape["rows"]):
        distance = shape["front"] - (row + 0.5) * shape["depth"]
        height = shape["base"] + FRONT_WALL + row * ROW_RISE
        for along in np.arange(shape["left"] + SEAT_SPACING / 2, shape["right"], SEAT_SPACING):
            if aisles.size and np.min(np.abs(aisles - along)) < AISLE_WIDTH / 2:
                continue
            xy = shape["facing"] * distance + shape["across"] * along
            out.append((xy[0], xy[1], height))
    return np.array(out, float).reshape(-1, 3)
