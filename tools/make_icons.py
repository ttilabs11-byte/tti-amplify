"""Build PWA icons and the header logo from the Tti brand icon (kept flat and unaltered)."""
from pathlib import Path
from PIL import Image

WORK = Path(__file__).resolve().parents[2]
OUT = WORK / "amplify" / "app" / "icons"
ICON = Image.open(WORK / "brand-icon-client.png").convert("RGBA")
LOGO = Image.open(WORK / "audit" / "logo-tti.png").convert("RGBA")
WHITE = (255, 255, 255, 255)


def tile(size: int, inner: float) -> Image.Image:
    """White square with the icon centred at `inner` of the width (maskable safe zone is 80%)."""
    canvas = Image.new("RGBA", (size, size), WHITE)
    w = int(size * inner)
    h = int(w * ICON.height / ICON.width)
    icon = ICON.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(icon, ((size - w) // 2, (size - h) // 2))
    return canvas


for size in (192, 512):
    tile(size, 0.78).save(OUT / f"icon-{size}.png", optimize=True)
tile(512, 0.62).save(OUT / "maskable-512.png", optimize=True)
tile(180, 0.76).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
tile(64, 0.84).save(OUT / "favicon-64.png", optimize=True)

mark = ICON.resize((160, int(160 * ICON.height / ICON.width)), Image.LANCZOS)
mark.save(OUT / "mark.png", optimize=True)
w = 900
LOGO.resize((w, int(w * LOGO.height / LOGO.width)), Image.LANCZOS).save(OUT / "logo-ondark.png", optimize=True)
print(sorted(p.name for p in OUT.iterdir()))
