"""Render the application's original geometric eye mark to Windows icon sizes."""
from pathlib import Path
from math import sqrt
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SCALE = 4
SIZE = 256
canvas = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)


def coords(points):
    return [(round(x * SCALE), round(y * SCALE)) for x, y in points]


def line(points, fill, width):
    draw.line(coords(points), fill=fill, width=round(width * SCALE), joint="curve")


emerald = "#101f1b"
cream = "#e3d5b4"
gold = "#a39c74"
draw.rounded_rectangle((6 * SCALE, 6 * SCALE, 250 * SCALE, 250 * SCALE), radius=48 * SCALE, fill=emerald)
draw.rounded_rectangle((15 * SCALE, 15 * SCALE, 241 * SCALE, 241 * SCALE), radius=41 * SCALE, outline="#2c4237", width=2 * SCALE)
hexagon = [(128, 29), (216, 78), (216, 178), (128, 227), (40, 178), (40, 78), (128, 29)]
line(hexagon, cream, 5)

# Two quadratic arcs reproduce the eye silhouette without requiring font assets.
upper, lower = [], []
for index in range(121):
    t = index / 120
    x = 58 + 140 * t
    upper.append((x, 128 - 140 * t * (1 - t)))
    lower.append((x, 128 + 140 * t * (1 - t)))
line(upper, cream, 6)
line(lower, cream, 6)
draw.ellipse((103 * SCALE, 103 * SCALE, 153 * SCALE, 153 * SCALE), fill=cream)
draw.ellipse((123 * SCALE, 112 * SCALE, 134 * SCALE, 123 * SCALE), fill=emerald)
for points in [[(128, 49), (128, 73)], [(128, 183), (128, 207)], [(52, 128), (72, 128)], [(184, 128), (204, 128)]]:
    line(points, gold, 4)

image = canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
target = ROOT / "assets" / "app.ico"
target.parent.mkdir(parents=True, exist_ok=True)
image.save(target, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(ROOT / "assets" / "app-icon.png")
print(f"Created {target}")
