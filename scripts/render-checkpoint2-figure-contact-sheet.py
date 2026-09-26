from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / "benchmarks" / "checkpoint2" / "figure-review-queue.json"
OUTPUT = ROOT / "tmp" / "pdfs" / "checkpoint2-figure-contact-sheet.jpg"
CELL_W, CELL_H = 420, 330
COLS = 3


def font(size):
    candidates = [
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/msyh.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


data = json.loads(QUEUE.read_text(encoding="utf-8"))
items = data["items"]
rows = (len(items) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * CELL_W, rows * CELL_H), "white")
draw = ImageDraw.Draw(sheet)
label_font = font(19)
small_font = font(14)

for index, item in enumerate(items):
    col, row = index % COLS, index // COLS
    x, y = col * CELL_W, row * CELL_H
    image_path = QUEUE.parent / item["imageAsset"]
    try:
        source = Image.open(image_path).convert("RGB")
        thumb = ImageOps.contain(source, (CELL_W - 24, 245))
        image_x = x + (CELL_W - thumb.width) // 2
        image_y = y + 42 + (245 - thumb.height) // 2
        sheet.paste(thumb, (image_x, image_y))
    except Exception as exc:
        draw.rectangle((x + 12, y + 42, x + CELL_W - 12, y + 287), outline="#b42318", width=3)
        draw.text((x + 20, y + 60), f"IMAGE ERROR: {exc}", fill="#b42318", font=small_font)
    draw.text((x + 12, y + 10), f"{index + 1:02d}  {item['figureLabel'] or 'unlabeled'}", fill="#102a43", font=label_font)
    modalities = ", ".join(item.get("candidateModalities", []))
    draw.text((x + 12, y + 292), modalities[:58], fill="#334e68", font=small_font)
    draw.rectangle((x, y, x + CELL_W - 1, y + CELL_H - 1), outline="#cbd5e1", width=1)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
sheet.save(OUTPUT, quality=90, optimize=True)
print(OUTPUT)
