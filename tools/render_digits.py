"""Render training glyphs for the digit model.

Draws 0-9 in many fonts with random tilt, slant, stroke weight, blur and low
resolution, then binarizes them the way the app's number finder does. Also
draws a "not a digit" class: mirrored digits (so a mirrored camera reads as
nothing rather than a wrong number), some letters and random blobs.

Output: a binary file of samples, each 1 label byte + a 64x64 bitmap packed
8 pixels per byte (1 = ink). Label 10 = not a digit.

    python tools/render_digits.py <fonts dir> <out file> [samples per glyph]
"""
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FONTS = [
    "arial.ttf", "arialbd.ttf", "ariblk.ttf", "bahnschrift.ttf", "calibri.ttf", "calibrib.ttf",
    "Candara.ttf", "Candarab.ttf", "consola.ttf", "consolab.ttf", "constan.ttf", "corbel.ttf",
    "corbelb.ttf", "cour.ttf", "courbd.ttf", "framd.ttf", "georgia.ttf", "georgiab.ttf",
    "impact.ttf", "lucon.ttf", "segoeui.ttf", "segoeuib.ttf", "seguibl.ttf", "seguisb.ttf",
    "tahoma.ttf", "tahomabd.ttf", "times.ttf", "timesbd.ttf", "trebuc.ttf", "trebucbd.ttf",
    "verdana.ttf", "verdanab.ttf",
]
SIZE = 64          # output bitmap
DIGIT_H = 52       # target glyph height in the output, like the app's redrawn digits
MIRROR_REJECT = "2345679"   # mirrored versions of these look unlike any digit
LETTERS = "AEFHKLMNPRTUVWXY"  # letters that don't resemble digits


def glyph(font_path, ch, mirror=False):
    font = ImageFont.truetype(font_path, 120)
    img = Image.new("L", (220, 220), 255)
    d = ImageDraw.Draw(img)
    d.text((110, 110), ch, font=font, fill=0, anchor="mm")
    if mirror:
        img = ImageOps.mirror(img)
    return img


def blob():
    img = Image.new("L", (220, 220), 255)
    d = ImageDraw.Draw(img)
    for _ in range(random.randint(1, 3)):
        x0, y0 = random.randint(40, 120), random.randint(30, 120)
        x1, y1 = x0 + random.randint(15, 70), y0 + random.randint(30, 80)
        if random.random() < 0.5:
            d.ellipse((x0, y0, x1, y1), outline=0, width=random.randint(6, 18))
        else:
            d.line((x0, y0, x1, y1), fill=0, width=random.randint(6, 20))
    return img


def augment(img):
    # Stroke weight: thicken or thin the ink.
    r = random.random()
    if r < 0.25:
        img = img.filter(ImageFilter.MinFilter(random.choice([3, 5])))
    elif r < 0.45:
        img = img.filter(ImageFilter.MaxFilter(3))
    # Slant and tilt.
    shear = random.uniform(-0.25, 0.25)
    img = img.transform(img.size, Image.AFFINE, (1, shear, -shear * 110, 0, 1, 0), fillcolor=255)
    img = img.rotate(random.uniform(-8, 8), resample=Image.BILINEAR, fillcolor=255)
    # Crop to the ink.
    box = ImageOps.invert(img).getbbox()
    if not box:
        return None
    img = img.crop(box)
    # Low resolution and blur, as from a distant camera, then back up to digit size.
    w, h = img.size
    low_h = random.choice([12, 16, 20, 26, 34, 48, DIGIT_H])
    low = img.resize((max(2, round(w * low_h / h)), low_h), Image.BOX)
    if random.random() < 0.4:
        low = low.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.0)))
    out_w = max(2, round(w * DIGIT_H / h))
    img = low.resize((min(out_w, SIZE - 4), DIGIT_H), Image.BILINEAR)
    # Binarize with a jittered threshold.
    t = random.randint(100, 160)
    img = img.point(lambda v: 0 if v < t else 255)
    canvas = Image.new("L", (SIZE, SIZE), 255)
    canvas.paste(img, ((SIZE - img.size[0]) // 2, (SIZE - img.size[1]) // 2))
    return canvas


def pack(img):
    px = img.load()
    out = bytearray(SIZE * SIZE // 8)
    for y in range(SIZE):
        for x in range(SIZE):
            if px[x, y] < 128:
                i = y * SIZE + x
                out[i >> 3] |= 1 << (i & 7)
    return bytes(out)


def main():
    fonts_dir, out_path = sys.argv[1], sys.argv[2]
    per = int(sys.argv[3]) if len(sys.argv) > 3 else 60
    random.seed(int(sys.argv[4]) if len(sys.argv) > 4 else 7)
    fonts = [os.path.join(fonts_dir, f) for f in FONTS if os.path.exists(os.path.join(fonts_dir, f))]
    jobs = []
    for f in fonts:
        for ch in "0123456789":
            jobs += [(f, ch, False, int(ch))] * per
        for ch in MIRROR_REJECT:
            jobs += [(f, ch, True, 10)] * max(1, per // 6)
        for ch in LETTERS:
            jobs += [(f, ch, False, 10)] * max(1, per // 12)
    jobs += [(None, None, False, 10)] * (per * 20)
    random.shuffle(jobs)
    n = 0
    with open(out_path, "wb") as fh:
        for f, ch, mirror, label in jobs:
            base = blob() if f is None else glyph(f, ch, mirror)
            img = augment(base)
            if img is None:
                continue
            fh.write(bytes([label]) + pack(img))
            n += 1
    print(f"{len(fonts)} fonts, {n} samples -> {out_path}")


if __name__ == "__main__":
    main()
