"""Build the printable capture card (A4, one page) that replaces "lay each leaf on white paper".

The card has three leaf boxes, one cherry box, black-white corner marks (fiducials) in three corners, a 20 mm
scale bar, and the words "Ondera / Jirani" and "not a diagnosis". The cooperative prints it at 100% on A4.

No PDF library is needed: the file is written by hand (vector shapes, built-in Helvetica), so it is a few KB and
the output is byte-for-byte reproducible.

Writes: app/public/capture-card.pdf   (served and precached by the farmer app)
        server/static/capture-card.pdf (linked from the project page)

The app does NOT detect the corner marks or the scale bar yet. They are on the card for a later check; today the
only gate is the photo quality gate (blur, exposure, leaf present).

Usage: python scripts/build_capture_card.py
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = [os.path.join(ROOT, "app", "public", "capture-card.pdf"), os.path.join(ROOT, "server", "static", "capture-card.pdf")]

MM = 72 / 25.4
W, H = 210.0, 297.0  # A4, millimetres; (0, 0) is the top-left corner in the helpers below

ops = []


def rect(x, y, w, h, grey=0.0):
    """Filled rectangle."""
    ops.append(f"{grey:.2f} g {x * MM:.2f} {(H - y - h) * MM:.2f} {w * MM:.2f} {h * MM:.2f} re f")


def frame(x, y, w, h, grey=0.55, width=0.3, dash=None):
    """Outline only. Light and thin, so it does not show up as part of a leaf."""
    d = f"[{dash[0] * MM:.2f} {dash[1] * MM:.2f}] 0 d" if dash else "[] 0 d"
    ops.append(f"{grey:.2f} G {width * MM:.2f} w {d} {x * MM:.2f} {(H - y - h) * MM:.2f} {w * MM:.2f} {h * MM:.2f} re S")


def text(x, y, s, size=10, bold=False, grey=0.0):
    s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    ops.append(f"BT {grey:.2f} g /F{2 if bold else 1} {size} Tf {x * MM:.2f} {(H - y) * MM:.2f} Td ({s}) Tj ET")


def fiducial(x, y, size=18.0):
    """Black square, white square, black centre (3 : 2 : 1), like a QR finder mark."""
    rect(x, y, size, size, 0)
    rect(x + size / 6, y + size / 6, size * 2 / 3, size * 2 / 3, 1)
    rect(x + size / 3, y + size / 3, size / 3, size / 3, 0)


def draw():
    # corner marks in three corners (the fourth stays empty, so the card's orientation can be told)
    fiducial(10, 10)
    fiducial(W - 28, 10)
    fiducial(10, H - 28)

    text(34, 18, "Ondera / Jirani", 20, bold=True)
    text(34, 24.5, "Capture card. Not a diagnosis.", 11)
    text(34, 29.5, "Kadi ya kupigia picha. Si utambuzi wa ugonjwa.", 9, grey=0.35)

    # three leaf boxes: one leaf in each, lying sideways, lower side up
    for i in range(3):
        y = 36 + i * 64
        frame(20, y, 170, 58)
        text(23, y + 6, str(i + 1), 13, bold=True, grey=0.55)
        text(29, y + 5.6, "Leaf, lower side up  /  Jani, upande wa chini juu", 8, grey=0.55)

    # cherry box
    frame(75, 230, 115, 55, dash=(2, 1.5))
    text(78, 236, "Cherry: one handful  /  Matunda: konzi moja", 8, grey=0.55)

    # 20 mm scale bar with end ticks
    rect(36, 246, 20, 1.0, 0)
    rect(36, 243.5, 0.5, 6, 0)
    rect(55.5, 243.5, 0.5, 6, 0)
    text(40.5, 241.5, "20 mm", 9, bold=True)
    text(34, 255, "Print at 100% on A4.", 7.5, grey=0.35)
    text(34, 258.5, "The bar must measure", 7.5, grey=0.35)
    text(34, 262, "20 mm.", 7.5, grey=0.35)

    text(34, 274, "Ondera / Jirani", 9, bold=True)
    text(34, 278, "not a diagnosis", 9)
    text(34, 282, "si utambuzi wa ugonjwa", 7.5, grey=0.35)
    text(34, 286, "Photograph one box at a time.", 7.5, grey=0.35)


def pdf():
    draw()
    stream = "\n".join(ops).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W * MM:.2f} {H * MM:.2f}] /Contents 4 0 R "
         f"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>").encode(),
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Title (Jirani capture card) /Author (Jirani hackathon prototype) /Subject (Capture card. Not a diagnosis.) >>",
    ]
    out = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1) + b"0000000000 65535 f \n"
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info 7 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return out


def main():
    data = pdf()
    for path in OUT:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "wb").write(data)
        print(f"wrote {path} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
