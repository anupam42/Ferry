# Generates the Relay mascot set (assets/mascot/) from shared parts.
# Usage: python3 scripts/generate-mascot.py assets/mascot assets/logo
#
# The artwork is the "Relay Clean Mascot" design: one silhouette with a thick
# navy outline, a blue tail and a mint scarf painted inside it (clipped, so no
# colour leaks past the outline), a white body with a soft highlight, and the
# head outline drawn on top. The face is kept separate so the expressions and
# turnaround views can swap it.
import math
import os
import sys

out = sys.argv[1]
logo_out = sys.argv[2] if len(sys.argv) > 2 else None
NAVY, SPARK, GOLD = "#092348", "#3CCBB0", "#F5C343"
BLUE, MINT, MINT2 = "#2586E6", "#66E4C0", "#65E4BF"

SIL = ("M 102,125 C 132,59 191,19 251,22 C 319,24 363,74 379,137 C 401,138 425,155 426,184 C 425,231 390,282 342,300 "
       "C 294,321 251,294 211,283 C 171,271 150,286 113,308 C 88,323 73,306 78,281 L 83,260 C 44,275 13,263 16,234 "
       "C 19,194 54,153 102,125 Z")
TAIL = ("M 102,125 C 70,147 31,186 22,220 C 13,253 34,265 66,254 C 92,245 98,239 90,269 C 78,314 91,320 120,302 "
        "C 159,278 188,266 221,279 C 255,290 276,305 307,305 C 275,289 255,259 217,237 C 179,212 143,209 110,224 "
        "C 85,236 49,252 41,235 C 30,213 74,151 102,125Z")
SCARF = ("M 119,302 C 162,276 191,267 220,278 C 267,296 296,314 342,300 C 390,284 425,229 426,184 C 427,161 410,144 379,137 "
         "C 394,168 383,206 358,229 C 324,262 291,263 252,250 C 216,238 184,231 155,242 C 132,251 113,272 102,291 Z")
BODY = ("M 99,150 C 126,78 178,27 247,22 C 315,18 363,70 378,131 C 388,169 382,206 368,227 C 355,246 328,258 296,256 "
        "C 257,253 228,232 188,226 C 152,221 132,234 101,240 C 81,244 69,238 75,221 C 83,197 91,176 99,150 Z")
SHINE = "M 103,150 C 126,92 163,58 201,42 C 177,86 170,134 180,187 C 149,178 115,191 91,214 C 77,228 74,219 82,198Z"
HEAD = "M 99,150 C 126,78 178,27 247,22 C 315,18 363,70 378,131 C 388,169 382,206 368,227"
VIEW = (0, 0, 450, 330)


def defs(p):
    return f'<defs><clipPath id="{p}clip"><path d="{SIL}"/></clipPath></defs>'


# ---------- faces ----------
EYES = [(206, 161), (304, 155)]
CHEEK = (169, 195)
MOUTH = (260, 182)  # centre of the mouth's top edge


def eyes(kind, dx=0, which=(0, 1)):
    pts = [(EYES[i][0] + dx, EYES[i][1]) for i in which]
    if kind == "open":
        return "".join(f'<ellipse cx="{x}" cy="{y}" rx="12" ry="17" fill="{NAVY}"/>' for x, y in pts)
    if kind == "happy":  # ^ ^
        return "".join(f'<path d="M{x-14} {y+6}q14-22 28 0" fill="none" stroke="{NAVY}" stroke-width="8" stroke-linecap="round"/>' for x, y in pts)
    if kind == "focused":  # narrowed eyes under determined brows
        s = "".join(f'<ellipse cx="{x}" cy="{y+5}" rx="11" ry="10" fill="{NAVY}"/>' for x, y in pts)
        for i, (x, y) in zip(which, pts):
            d = f"M{x-17} {y-22}l29 11" if i == 0 else f"M{x+17} {y-22}l-29 11"
            s += f'<path d="{d}" stroke="{NAVY}" stroke-width="7" stroke-linecap="round"/>'
        return s
    if kind == "wink":  # left eye open, right eye winking
        lx, ly, rx, ry = EYES[0][0] + dx, EYES[0][1], EYES[1][0] + dx, EYES[1][1]
        return (f'<ellipse cx="{lx}" cy="{ly}" rx="12" ry="17" fill="{NAVY}"/>'
                f'<path d="M{rx-14} {ry+4}q14-16 28 0" fill="none" stroke="{NAVY}" stroke-width="8" stroke-linecap="round"/>')
    if kind == "surprised":  # wide round eyes
        return "".join(f'<circle cx="{x}" cy="{y}" r="13" fill="#fff" stroke="{NAVY}" stroke-width="6"/><circle cx="{x}" cy="{y+1}" r="6" fill="{NAVY}"/>' for x, y in pts)
    if kind == "sleepy":  # closed, relaxed
        return "".join(f'<path d="M{x-14} {y}q14 12 28 0" fill="none" stroke="{NAVY}" stroke-width="8" stroke-linecap="round"/>' for x, y in pts)
    if kind == "worried":  # open eyes, brows raised in the middle
        s = "".join(f'<ellipse cx="{x}" cy="{y+2}" rx="11" ry="15" fill="{NAVY}"/>' for x, y in pts)
        (lx, ly), (rx, ry) = pts[0], pts[-1]
        s += f'<path d="M{lx-16} {ly-22}l28-9" stroke="{NAVY}" stroke-width="7" stroke-linecap="round"/>'
        s += f'<path d="M{rx+16} {ry-22}l-28-9" stroke="{NAVY}" stroke-width="7" stroke-linecap="round"/>'
        return s
    if kind == "sad":  # open eyes, drooping brows, a tear
        s = "".join(f'<ellipse cx="{x}" cy="{y+4}" rx="11" ry="14" fill="{NAVY}"/>' for x, y in pts)
        (lx, ly), (rx, ry) = pts[0], pts[-1]
        s += f'<path d="M{lx-16} {ly-14}l26-10" stroke="{NAVY}" stroke-width="7" stroke-linecap="round"/>'
        s += f'<path d="M{rx+16} {ry-14}l-26-10" stroke="{NAVY}" stroke-width="7" stroke-linecap="round"/>'
        s += f'<path d="M{lx-8} {ly+22}c-6 9-9 14-9 18a9 9 0 0 0 18 0c0-4-3-9-9-18z" fill="#6EC1FF" stroke="{NAVY}" stroke-width="3"/>'
        return s
    if kind == "love":  # heart eyes
        return "".join(f'<path d="M{x} {y+13}l-14-14a8.5 8.5 0 0 1 14-10 8.5 8.5 0 0 1 14 10z" fill="#FF5C7A" stroke="{NAVY}" stroke-width="4" stroke-linejoin="round"/>' for x, y in pts)
    if kind == "thinking":  # looking up and to the side
        return "".join(f'<ellipse cx="{x}" cy="{y}" rx="12" ry="17" fill="{NAVY}"/><ellipse cx="{x+4}" cy="{y-7}" rx="5" ry="6" fill="#fff"/>' for x, y in pts)
    if kind == "confused":  # one brow up, one eye a little smaller
        lx, ly, rx, ry = EYES[0][0] + dx, EYES[0][1], EYES[1][0] + dx, EYES[1][1]
        return (f'<ellipse cx="{lx}" cy="{ly+2}" rx="10" ry="13" fill="{NAVY}"/><ellipse cx="{rx}" cy="{ry}" rx="12" ry="17" fill="{NAVY}"/>'
                f'<path d="M{rx-14} {ry-26}q14-12 28-2" fill="none" stroke="{NAVY}" stroke-width="7" stroke-linecap="round"/>'
                f'<path d="M{lx-14} {ly-20}l26 4" stroke="{NAVY}" stroke-width="7" stroke-linecap="round"/>')
    if kind == "cool":  # sunglasses
        (lx, ly), (rx, ry) = pts[0], pts[-1]
        lens = lambda x, y: (f'<path d="M{x-24} {y-12}h48c0 18-8 28-24 28s-24-10-24-28z" fill="{NAVY}"/>'
                             f'<path d="M{x-14} {y-5}l8 8" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".8"/>')
        return lens(lx, ly) + lens(rx, ry) + f'<path d="M{lx+24} {ly-10}Q{(lx + rx) / 2} {ly - 18} {rx-24} {ry-10}" fill="none" stroke="{NAVY}" stroke-width="6" stroke-linecap="round"/>'
    if kind == "laughing":  # squeezed shut, with happy tears
        s = "".join(f'<path d="M{x-15} {y-4}l15 8-15 8" fill="none" stroke="{NAVY}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' for x, y in pts[:1])
        s += "".join(f'<path d="M{x+15} {y-4}l-15 8 15 8" fill="none" stroke="{NAVY}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' for x, y in pts[1:])
        (lx, ly), (rx, ry) = pts[0], pts[-1]
        tear = lambda x, y: f'<path d="M{x} {y}c-5 7-7 11-7 14a7 7 0 0 0 14 0c0-3-2-7-7-14z" fill="#6EC1FF" stroke="{NAVY}" stroke-width="3"/>'
        return s + tear(lx - 32, ly + 10) + tear(rx + 32, ry + 10)
    if kind == "shy":  # glancing down
        return "".join(f'<ellipse cx="{x}" cy="{y+8}" rx="9" ry="11" fill="{NAVY}"/>' for x, y in pts)
    if kind == "dizzy":  # spirals
        def swirl(cx, cy):
            # an Archimedean spiral: 2.5 turns out to a radius of 15
            ps = []
            for k in range(0, 91):
                t = k / 90 * 2 * 2 * math.pi
                r = 2 + 13 * k / 90
                ps.append(f"{cx + r * math.cos(t):.1f} {cy + r * math.sin(t):.1f}")
            return f'<path d="M{" L".join(ps)}" fill="none" stroke="{NAVY}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>'
        return "".join(swirl(x, y) for x, y in pts)
    if kind == "excited":  # round eyes with a shine
        return "".join(f'<circle cx="{x}" cy="{y}" r="15" fill="{NAVY}"/><circle cx="{x+5}" cy="{y-6}" r="5" fill="#fff"/>' for x, y in pts)
    return ""


def blush():
    x, y = CHEEK
    return (f'<ellipse cx="{x}" cy="{y}" rx="24" ry="12" fill="#FF9DA8" opacity=".75"/>'
            + "".join(f'<path d="M{x - 12 + i * 10} {y - 4}l-4 8" stroke="#E2607A" stroke-width="3" stroke-linecap="round"/>' for i in range(3))
            + f'<ellipse cx="{EYES[1][0] + 34}" cy="{EYES[1][1] + 32}" rx="16" ry="9" fill="#FF9DA8" opacity=".55"/>')


def cheek(dx=0):
    return f'<ellipse cx="{CHEEK[0]+dx}" cy="{CHEEK[1]}" rx="17" ry="9" fill="#FFC5C5" opacity=".9"/>'


def mouth(kind, dx=0):
    x, y = MOUTH[0] + dx, MOUTH[1]
    if kind == "open":
        return (f'<path d="M {x-20} {y+3} Q {x} {y-4} {x+20} {y+2} Q {x+24} {y+35} {x+1} {y+36} Q {x-19} {y+36} {x-20} {y+3}Z" fill="{NAVY}"/>'
                f'<path d="M {x-6} {y+29} Q {x+8} {y+15} {x+19} {y+28}" fill="#FF9189"/>')
    if kind == "big":
        return (f'<path d="M {x-25} {y+1} Q {x} {y-7} {x+25} {y} Q {x+29} {y+42} {x+1} {y+43} Q {x-24} {y+43} {x-25} {y+1}Z" fill="{NAVY}"/>'
                f'<path d="M {x-9} {y+35} Q {x+8} {y+17} {x+22} {y+33}" fill="#FF9189"/>')
    if kind == "o":  # surprised
        return f'<ellipse cx="{x}" cy="{y+18}" rx="11" ry="14" fill="{NAVY}"/>'
    line = {
        "smirk": f"M{x-16} {y+12}q16 10 32-4",
        "small": f"M{x-12} {y+8}q12 16 24 0",
        "side": f"M{x+8} {y+8}q10 12 22 2",
        "sleepy": f"M{x-8} {y+14}q8 6 16 0",
        "wavy": f"M{x-20} {y+18}q10-10 20 0q10 10 20 0",
        "frown": f"M{x-16} {y+24}q16-16 32 0",
        "flat": f"M{x-10} {y+16}h18",
        "tiny": f"M{x-8} {y+14}q8 8 16 0",
        "cool": f"M{x-14} {y+12}q18 12 30-6",
    }[kind]
    return f'<path d="{line}" fill="none" stroke="{NAVY}" stroke-width="8" stroke-linecap="round"/>'


def zzz():
    # (x, y, size, stroke, opacity): rising away from the head, smaller and fainter each time
    out = ""
    for x, y, size, w, o in [(390, 96, 24, 7, 1), (414, 54, 18, 6, .8), (433, 18, 13, 5, .6)]:
        cx, cy = x + size / 2, y + size / 2
        out += (f'<path d="M{x} {y}h{size}l-{size} {size}h{size}" transform="rotate(-12 {cx} {cy})" opacity="{o}" '
                f'fill="none" stroke="{SPARK}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
    return out


def dots():
    # a thought trail: three dots growing away from the head
    return "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{SPARK}" opacity="{o}"/>'
                   for x, y, r, o in [(392, 108, 5, .7), (410, 74, 7, .85), (430, 36, 10, 1)])


def question():
    return (f'<path d="M398 30a16 16 0 1 1 22 15c-6 3-8 6-8 13" fill="none" stroke="{SPARK}" stroke-width="9" stroke-linecap="round"/>'
            f'<circle cx="412" cy="76" r="5.5" fill="{SPARK}"/>')


def confetti():
    bits = [(130, 40, "#F5C343", 0), (96, 84, "#3CCBB0", 30), (186, 12, "#FF8FA3", -20), (348, 16, "#2586E6", 15),
            (392, 58, "#F5C343", -35), (418, 104, "#FF8FA3", 25), (300, 10, "#3CCBB0", 50), (62, 128, "#2586E6", -15)]
    return "".join(f'<rect x="{x}" y="{y}" width="22" height="10" rx="4" fill="{c}" transform="rotate({r} {x + 11} {y + 5})"/>'
                   for x, y, c, r in bits) + (f'<circle cx="166" cy="62" r="7" fill="#2586E6"/><circle cx="414" cy="20" r="7" fill="#FF8FA3"/>'
                                              f'<circle cx="250" cy="12" r="6" fill="#F5C343"/>')


def sparkle(color):
    return (f'<g stroke="{color}" stroke-width="10" stroke-linecap="round">'
            '<path d="M362 40l8 24"/><path d="M406 56l-17 17"/><path d="M426 98l-24 4"/></g>')


# ---------- figure ----------
def figure(p, face="", spark=None, mirror=False, shine=True, extra=""):
    g = (f'<g clip-path="url(#{p}clip)">'
         f'<path d="{SIL}" fill="{MINT}"/>'
         f'<path d="{TAIL}" fill="{BLUE}" stroke="{BLUE}" stroke-width="16" stroke-linejoin="round"/>'
         f'<path d="{SCARF}" fill="{MINT2}"/>'
         f'<path d="{BODY}" fill="#FFFFFF"/>'
         + (f'<path d="{SHINE}" fill="#E7F5FF" opacity=".75"/>' if shine else "")
         + '</g>'
         f'<path d="{SIL}" fill="none" stroke="{NAVY}" stroke-width="8" stroke-linejoin="round"/>'
         f'<path d="{HEAD}" fill="none" stroke="{NAVY}" stroke-width="8" stroke-linecap="round"/>'
         + face)
    if spark:
        g += sparkle(spark)
    g += extra
    if mirror:
        g = f'<g transform="translate({2 * VIEW[0] + VIEW[2]} 0) scale(-1 1)">{g}</g>'
    return g


def svg(content, view=VIEW, label="Relay, the Ferry mascot", title="Relay — The Sync Spirit"):
    vb = " ".join(str(v) for v in view)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="{label}">\n  <title>{title}</title>\n  {content}\n</svg>\n'


FACE = lambda e, m: eyes(e) + mouth(m) + cheek()
SIDE = lambda: eyes("open", 34, (1,)) + mouth("side", 30)
POSES = {
    "relay":           lambda p: figure(p, FACE("open", "open"), spark=SPARK),
    "relay-front":     lambda p: figure(p, FACE("open", "open")),
    "relay-side":      lambda p: figure(p, SIDE(), mirror=True),
    "relay-back":      lambda p: figure(p, "", shine=False),
    "relay-side-left": lambda p: figure(p, SIDE()),
    "relay-happy":     lambda p: figure(p, FACE("happy", "big")),
    "relay-focused":   lambda p: figure(p, FACE("focused", "smirk")),
    "relay-excited":   lambda p: figure(p, FACE("excited", "small"), spark=GOLD),
    "relay-wink":      lambda p: figure(p, FACE("wink", "open")),
    "relay-surprised": lambda p: figure(p, FACE("surprised", "o")),
    "relay-sleepy":    lambda p: figure(p, FACE("sleepy", "sleepy"), extra=zzz()),
    "relay-worried":   lambda p: figure(p, FACE("worried", "wavy")),
    "relay-sad":       lambda p: figure(p, eyes("sad") + mouth("frown")),
    "relay-love":      lambda p: figure(p, FACE("love", "big")),
    "relay-thinking":  lambda p: figure(p, FACE("thinking", "flat"), extra=dots()),
    "relay-confused":  lambda p: figure(p, eyes("confused") + mouth("wavy") + cheek(), extra=question()),
    "relay-cool":      lambda p: figure(p, eyes("cool") + mouth("cool") + cheek()),
    "relay-laughing":  lambda p: figure(p, FACE("laughing", "big")),
    "relay-shy":       lambda p: figure(p, eyes("shy") + mouth("tiny") + blush()),
    "relay-dizzy":     lambda p: figure(p, FACE("dizzy", "wavy")),
    "relay-party":     lambda p: figure(p, FACE("happy", "big"), extra=confetti()),
}

# what each expression is for (shown on the brand sheet)
EXPRESSIONS = [
    ("relay-happy", "Happy", "all synced"), ("relay-focused", "Focused", "syncing"), ("relay-excited", "Excited", "new pair"),
    ("relay-wink", "Wink", "tip"), ("relay-surprised", "Surprised", "big batch"), ("relay-sleepy", "Sleepy", "paused"),
    ("relay-worried", "Worried", "conflict"), ("relay-sad", "Sad", "error"), ("relay-love", "Love", "thank you"),
    ("relay-thinking", "Thinking", "planning"), ("relay-confused", "Confused", "needs a look"), ("relay-cool", "Cool", "pushed"),
    ("relay-laughing", "Laughing", "merged cleanly"), ("relay-shy", "Shy", "first run"), ("relay-dizzy", "Dizzy", "offline"),
    ("relay-party", "Party", "released"),
]

# ---------- line icons, 48x48 ----------
ICON = f'fill="none" stroke="{NAVY}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"'
ICONS = {
    # Relay's own silhouette, scaled down, with a simple face
    "icon-relay":  f'<g transform="translate(1.1 6) scale(0.105)"><path d="{SIL}" fill="none" stroke="{NAVY}" stroke-width="28" stroke-linejoin="round"/></g><circle cx="22.7" cy="22.6" r="1.9" fill="{NAVY}"/><circle cx="33" cy="22" r="1.9" fill="{NAVY}"/><path d="M25.7 26.4q2.5 2.6 5 0" {ICON}/>',
    "icon-sync":   f'<path d="M37 19a14 14 0 0 0-25-4M11 29a14 14 0 0 0 25 4" {ICON}/><path d="M12 8v7h7M36 40v-7h-7" {ICON}/>',
    "icon-layers": f'<path d="M24 8 41 17 24 26 7 17z" {ICON}/><path d="M7 24l17 9 17-9M7 31l17 9 17-9" {ICON}/>',
    "icon-branch": f'<circle cx="15" cy="11" r="4" {ICON}/><circle cx="15" cy="37" r="4" {ICON}/><circle cx="33" cy="15" r="4" {ICON}/><path d="M15 15v18M33 19c0 8-6 10-12 11-4 1-6 2-6 3" {ICON}/>',
    "icon-shield": f'<path d="M24 6 39 12v11c0 10-6 17-15 20-9-3-15-10-15-20V12z" {ICON}/><path d="M17 24l5 5 9-10" {ICON}/>',
}

os.makedirs(out, exist_ok=True)
for name, pose in POSES.items():
    open(os.path.join(out, name + ".svg"), "w").write(svg(defs("") + "\n  " + pose("")))
for name, body in ICONS.items():
    nice = name.replace("icon-", "")
    open(os.path.join(out, name + ".svg"), "w").write(svg(body, (0, 0, 48, 48), label=nice + " icon", title=nice.capitalize()))


# ---------- brand sheet ----------
def place(name, x, y, scale, p):
    return f'<g transform="translate({x} {y}) scale({scale}) translate({-VIEW[0]} 0)">{POSES[name](p)}</g>'


def label(text, x, y, size=15, weight=500, color=NAVY, anchor="middle"):
    return (f'<text x="{x}" y="{y}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" '
            f'font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{text}</text>')


def chip(text, x, y, w):
    return f'<rect x="{x}" y="{y}" width="{w}" height="26" rx="13" fill="#E5EDFB"/>' + label(text, x + w / 2, y + 18, 13, 700)


ids = "abcdefghij"
sheet = ['<rect width="720" height="SHEET_H" rx="28" fill="#F6F8FC"/>', "".join(defs(p) for p in ids) + "".join(defs("e" + str(i)) for i in range(len(EXPRESSIONS)))]
sheet.append('<rect x="40" y="36" width="130" height="36" rx="18" fill="#3D7BEA"/>' + label("Mascot", 105, 60, 16, 700, "#fff"))
sheet.append(label("Relay", 200, 66, 40, 800, NAVY, "start"))
sheet.append(label("The Sync Spirit", 200, 96, 20, 700, NAVY, "start"))
sheet.append(label("A friendly, floating companion that keeps", 360, 138, 19, 400, "#2A3550"))
sheet.append(label("your files and projects in flow.", 360, 164, 19, 400, "#2A3550"))
sheet.append(place("relay", 144, 192, 0.96, "a"))
sheet.append('<ellipse cx="350" cy="530" rx="90" ry="9" fill="#CBD5EE"/>')
sheet.append('<rect x="24" y="560" width="672" height="210" rx="22" fill="#FFFFFF" stroke="#E3E8F2"/>' + chip("Turnaround", 40, 572, 120))
for i, (n, t) in enumerate([("relay-front", "Front"), ("relay-side", "Side"), ("relay-back", "Back"), ("relay-side-left", "Side")]):
    sheet.append(place(n, 46 + i * 164, 618, 0.32, ids[i + 1]) + label(t, 46 + i * 164 + 72, 752))
rows = (len(EXPRESSIONS) + 3) // 4
panel_h = 56 + rows * 152
sheet.append(f'<rect x="24" y="786" width="672" height="{panel_h}" rx="22" fill="#FFFFFF" stroke="#E3E8F2"/>' + chip("Expressions", 40, 798, 124))
for i, (n, t, use) in enumerate(EXPRESSIONS):
    col, row = i % 4, i // 4
    x, y = 40 + col * 162, 830 + row * 152
    sheet.append(place(n, x, y, 0.33, "e" + str(i)) + label(t, x + 74, y + 124) + label(use, x + 74, y + 140, 12, 400, "#6B7590"))
icons_y = 786 + panel_h + 16
sheet.append(f'<rect x="24" y="{icons_y}" width="672" height="136" rx="22" fill="#FFFFFF" stroke="#E3E8F2"/>' + chip("Icon variants", 40, icons_y + 12, 134))
for i, n in enumerate(ICONS):
    sheet.append(f'<g transform="translate({70 + i * 128} {icons_y + 52}) scale(1.4)">{ICONS[n]}</g>')
SHEET_H = icons_y + 136 + 22
open(os.path.join(out, "relay-sheet.svg"), "w").write(svg("\n  ".join(sheet).replace("SHEET_H", str(SHEET_H)), (0, 0, 720, SHEET_H), label="Relay brand sheet"))
print("wrote", len(POSES) + len(ICONS) + 1, "files")


# ---------- logo set (assets/logo) ----------
# Relay plus hand-drawn "Ferry" lettering (strokes, not a font, so it looks
# the same everywhere). Lettering is drawn in a 64-unit-high box.
LETTERS = ('<path d="M8 48V16h19M8 32h15"/><path d="M35 38h20a10 10 0 1 0-3 7.2"/>'
           '<path d="M65 28v20M65 38c0-6.5 4-10 11-10"/><path d="M85 28v20M85 38c0-6.5 4-10 11-10"/>'
           '<path d="M103 28l10 19M123 28l-14 29c-2 4-5 5-9 4.5"/>')
ICON_VIEW = (8, 14, 426, 312)  # Relay without the empty margin


def wordmark(color):
    s = 100 / 64
    mark = f'<svg x="0" y="0" width="137" height="100" viewBox="{" ".join(map(str, ICON_VIEW))}">{defs("w")}{figure("w", FACE("open", "open"))}</svg>'
    text = (f'<g transform="translate(156 2) scale({s:.4f})" fill="none" stroke="{color}" stroke-width="7" '
            f'stroke-linecap="round" stroke-linejoin="round">{LETTERS}</g>')
    return svg(mark + text, (0, 0, 364, 100), label="Ferry", title="Ferry")


if logo_out:
    os.makedirs(logo_out, exist_ok=True)
    open(os.path.join(logo_out, "icon.svg"), "w").write(svg(defs("") + figure("", FACE("open", "open")), ICON_VIEW, label="Ferry", title="Ferry"))
    open(os.path.join(logo_out, "logo.svg"), "w").write(wordmark(NAVY))
    open(os.path.join(logo_out, "logo-dark.svg"), "w").write(wordmark("#F2F5FA"))
    print("wrote 3 logo files")
