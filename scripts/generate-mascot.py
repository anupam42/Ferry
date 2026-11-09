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


# ---------- animated greeting: Happy Diwali ----------
# Plain SVG + CSS animation, so it plays as an <img> (README, browsers, chat).
# Everything holds still for people who ask for reduced motion.
def diya(x, y, scale, delay, glow_id):
    """A clay lamp with a flickering flame, centred at the rim (x, y)."""
    return f'''<g transform="translate({x} {y}) scale({scale})">
    <circle cx="0" cy="-30" r="46" fill="url(#{glow_id})" class="glow" style="animation-delay:{delay}s"/>
    <path d="M-46 0C-40 30 40 30 46 0Z" fill="url(#clay)" stroke="#5A2A12" stroke-width="4" stroke-linejoin="round"/>
    <path d="M-46 0C-20 -10 20 -10 46 0" fill="none" stroke="#F3B35C" stroke-width="5" stroke-linecap="round"/>
    <circle cx="-22" cy="12" r="3.5" fill="#F7C873"/><circle cx="0" cy="16" r="3.5" fill="#F7C873"/><circle cx="22" cy="12" r="3.5" fill="#F7C873"/>
    <g class="flame" style="animation-delay:{delay}s">
      <path d="M0 -6C-14 -18 -12 -34 0 -54C12 -34 14 -18 0 -6Z" fill="url(#flame)"/>
      <path d="M0 -10C-6 -18 -5 -26 0 -34C5 -26 6 -18 0 -10Z" fill="#FFF6C9"/>
    </g>
  </g>'''


def burst(x, y, r, colour, delay, n=12):
    dots = "".join(
        f'<circle cx="{x + r * math.cos(2 * math.pi * k / n):.1f}" cy="{y + r * math.sin(2 * math.pi * k / n):.1f}" r="{4 if k % 2 else 3}" fill="{colour}"/>'
        for k in range(n))
    rays = "".join(
        f'<path d="M{x + r * .45 * math.cos(2 * math.pi * k / n):.1f} {y + r * .45 * math.sin(2 * math.pi * k / n):.1f}'
        f'L{x + r * .8 * math.cos(2 * math.pi * k / n):.1f} {y + r * .8 * math.sin(2 * math.pi * k / n):.1f}" stroke="{colour}" stroke-width="3" stroke-linecap="round"/>'
        for k in range(0, n, 2))
    return f'<g class="burst" style="transform-origin:{x}px {y}px;animation-delay:{delay}s">{rays}{dots}</g>'


def diwali():
    W, H = 600, 470
    stars = [(60, 120, 0), (180, 96, .7), (420, 104, 1.3), (548, 128, .4), (34, 260, 1.8), (566, 300, 1.1), (250, 150, 2.2), (360, 150, .9)]
    bulbs = []
    for i in range(13):  # a garland hanging in a gentle curve
        bx = 30 + i * 45
        by = 26 + 22 * math.sin(math.pi * i / 12)
        c = ["#FFD166", "#FF7AA2", "#7EE0C3", "#7FB4FF"][i % 4]
        bulbs.append(f'<circle cx="{bx}" cy="{by + 10:.1f}" r="7" fill="{c}" class="bulb" style="animation-delay:{(i % 3) * .5}s"/>')
    garland = (f'<path d="M14 26Q300 92 586 26" fill="none" stroke="#C9A24A" stroke-width="2.5" opacity=".7"/>' + "".join(bulbs))
    relay = figure("d", FACE("happy", "big"))
    content = f'''<style>
    .float {{ animation: float 3.6s ease-in-out infinite; }}
    .flame {{ transform-box: fill-box; transform-origin: 50% 100%; animation: flicker .9s ease-in-out infinite alternate; }}
    .glow {{ animation: glow 1.8s ease-in-out infinite alternate; }}
    .burst {{ opacity: 0; animation: burst 3s ease-out infinite; }}
    .star {{ animation: twinkle 2.4s ease-in-out infinite; }}
    .bulb {{ animation: blink 1.5s steps(2, jump-none) infinite; }}
    .title {{ animation: shimmer 4s ease-in-out infinite; }}
    @keyframes float {{ 0%, 100% {{ transform: translateY(0); }} 50% {{ transform: translateY(-10px); }} }}
    @keyframes flicker {{ 0% {{ transform: scale(1, 1) skewX(0deg); }} 50% {{ transform: scale(.94, 1.08) skewX(-3deg); }} 100% {{ transform: scale(1.04, .95) skewX(3deg); }} }}
    @keyframes glow {{ from {{ opacity: .55; }} to {{ opacity: 1; }} }}
    @keyframes burst {{ 0% {{ opacity: 0; transform: scale(.15); }} 15% {{ opacity: 1; }} 60% {{ opacity: .9; transform: scale(1); }} 100% {{ opacity: 0; transform: scale(1.12); }} }}
    @keyframes twinkle {{ 0%, 100% {{ opacity: .25; }} 50% {{ opacity: 1; }} }}
    @keyframes blink {{ 0% {{ opacity: 1; }} 100% {{ opacity: .35; }} }}
    @keyframes shimmer {{ 0%, 100% {{ opacity: 1; }} 50% {{ opacity: .82; }} }}
    @media (prefers-reduced-motion: reduce) {{ * {{ animation: none !important; }} .burst {{ opacity: 1; }} }}
  </style>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#160F3B"/><stop offset="1" stop-color="#2D1A5C"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset="1" stop-color="#F2B33D"/></linearGradient>
    <linearGradient id="clay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9783A"/><stop offset="1" stop-color="#9C4219"/></linearGradient>
    <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FF7A1A"/><stop offset=".55" stop-color="#FFB627"/><stop offset="1" stop-color="#FFE57A"/></linearGradient>
    <radialGradient id="glowA"><stop offset="0" stop-color="#FFC94D" stop-opacity=".75"/><stop offset="1" stop-color="#FFC94D" stop-opacity="0"/></radialGradient>
    <radialGradient id="warm" cx="0.5" cy="0.85" r="0.6"><stop offset="0" stop-color="#FFB547" stop-opacity=".28"/><stop offset="1" stop-color="#FFB547" stop-opacity="0"/></radialGradient>
    <clipPath id="dclip"><path d="{SIL}"/></clipPath>
  </defs>
  <rect width="{W}" height="{H}" rx="28" fill="url(#sky)"/>
  <rect width="{W}" height="{H}" rx="28" fill="url(#warm)"/>
  {"".join(f'<circle cx="{x}" cy="{y}" r="2.6" fill="#FFF4D6" class="star" style="animation-delay:{d}s"/>' for x, y, d in stars)}
  {garland}
  {burst(86, 196, 44, "#FFD166", 0)}
  {burst(514, 186, 50, "#FF7AA2", 1)}
  {burst(520, 312, 34, "#7EE0C3", 2)}
  {burst(78, 330, 30, "#7FB4FF", 1.6)}
  <text x="300" y="104" text-anchor="middle" class="title" font-family="ui-rounded, 'SF Pro Rounded', Nunito, 'Varela Round', system-ui, sans-serif" font-size="46" font-weight="800" fill="url(#gold)" letter-spacing="1">Happy Diwali</text>
  <text x="300" y="134" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="16" fill="#E9DDFB" opacity=".9">Wishing you light, joy and conflict-free syncs</text>
  <g class="float"><g transform="translate(138 150) scale(0.72)">{relay}</g></g>
  {diya(300, 420, 1.0, 0, "glowA")}
  {diya(156, 430, .62, .4, "glowA")}
  {diya(444, 430, .62, .8, "glowA")}'''
    return svg(content, (0, 0, W, H), label="Relay wishing you a Happy Diwali", title="Happy Diwali from Relay")


open(os.path.join(out, "relay-diwali.svg"), "w").write(diwali())
print("wrote relay-diwali.svg")


# ---------- more animated cards ----------
import random

TITLE_FONT = "ui-rounded, 'SF Pro Rounded', Nunito, 'Varela Round', system-ui, sans-serif"
BODY_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
BASE_CSS = """
    .float { animation: float 3.6s ease-in-out infinite; }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }"""


def relay_at(pid, x, y, scale, face, on_top="", spark=None):
    """Relay placed in a card; on_top is drawn in Relay's own coordinates (hats, paint)."""
    return (f'<g class="float"><g transform="translate({x} {y}) scale({scale})">'
            f'<defs><clipPath id="{pid}clip"><path d="{SIL}"/></clipPath></defs>{figure(pid, face, spark=spark)}{on_top}</g></g>')


def card(name, label_, title, sky, title_fill, subtitle, sub_color, body, css, defs_extra="", title_y=84, sub_y=446,
         H=470, title_font=None, title_size=46):
    W = 600
    content = f'''<style>{BASE_CSS}{css}
  </style>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{sky[0]}"/><stop offset="1" stop-color="{sky[1]}"/></linearGradient>
    {defs_extra}
  </defs>
  <rect width="{W}" height="{H}" rx="28" fill="url(#sky)"/>
  {body}
  <text x="300" y="{title_y}" text-anchor="middle" font-family="{title_font or TITLE_FONT}" font-size="{title_size}" font-weight="800" fill="{title_fill}" letter-spacing="1">{title}</text>
  <text x="300" y="{sub_y}" text-anchor="middle" font-family="{BODY_FONT}" font-size="16" fill="{sub_color}">{subtitle}</text>'''
    open(os.path.join(out, name), "w").write(svg(content, (0, 0, W, H), label=label_, title=label_))


def falling(n, shape, seed, colours, w=600, h=470, dmin=5, dmax=11):
    """Things that fall forever (snow, confetti): each loops from above the card to below it."""
    rnd = random.Random(seed)
    out = ""
    for i in range(n):
        x = rnd.uniform(10, w - 10)
        dur = rnd.uniform(dmin, dmax)
        delay = -rnd.uniform(0, dur)  # negative delay: already mid-fall at the start
        c = colours[i % len(colours)]
        out += f'<g class="fall" style="animation-duration:{dur:.1f}s;animation-delay:{delay:.1f}s"><g transform="translate({x:.0f} -20)">{shape(rnd, c)}</g></g>'
    return out


def blob(cx, cy, r, seed, n=9):
    """A splash: a circle with soft random bumps."""
    rnd = random.Random(seed)
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        rr = r * rnd.uniform(.72, 1.18)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d = f"M{(pts[0][0] + pts[-1][0]) / 2:.1f} {(pts[0][1] + pts[-1][1]) / 2:.1f}"
    for i in range(n):
        p, q = pts[i], pts[(i + 1) % n]
        d += f"Q{p[0]:.1f} {p[1]:.1f} {(p[0] + q[0]) / 2:.1f} {(p[1] + q[1]) / 2:.1f}"
    return d + "Z"


# Holi: colour splashes pop around Relay, powder drifts up, Relay has paint spots
def holi():
    cols = ["#FF4F8B", "#FFC83D", "#33C48D", "#3D8BFF", "#A15CFF", "#FF7A3D"]
    spots = [(70, 190, 46), (530, 200, 52), (110, 360, 40), (500, 360, 44), (300, 150, 26), (40, 300, 28), (565, 300, 26)]
    splashes = "".join(
        f'<path d="{blob(x, y, r, i * 7 + 3)}" fill="{cols[i % len(cols)]}" class="pop" style="transform-origin:{x}px {y}px;animation-delay:{i * .45:.2f}s"/>'
        for i, (x, y, r) in enumerate(spots))
    rnd = random.Random(11)
    powder = "".join(
        f'<circle cx="{rnd.uniform(40, 560):.0f}" cy="{rnd.uniform(300, 460):.0f}" r="{rnd.uniform(3, 7):.1f}" fill="{cols[i % 6]}" class="rise" '
        f'style="animation-duration:{rnd.uniform(4, 7):.1f}s;animation-delay:-{rnd.uniform(0, 6):.1f}s"/>' for i in range(26))
    paint = (f'<g clip-path="url(#hclip)">'
             f'<path d="{blob(150, 120, 22, 5)}" fill="#FF4F8B" opacity=".85"/><path d="{blob(330, 80, 16, 9)}" fill="#FFC83D" opacity=".9"/>'
             f'<path d="{blob(300, 236, 18, 4)}" fill="#A15CFF" opacity=".8"/><path d="{blob(120, 230, 14, 2)}" fill="#33C48D" opacity=".85"/></g>')
    body = splashes + powder + relay_at("h", 138, 140, .72, FACE("laughing", "big"), paint)
    css = """
    .pop { animation: pop 3.2s ease-out infinite; }
    .rise { animation: rise linear infinite; }
    @keyframes pop { 0% { transform: scale(0); opacity: 0; } 18% { transform: scale(1.08); opacity: .95; } 30% { transform: scale(1); } 80% { opacity: .9; } 100% { transform: scale(1); opacity: 0; } }
    @keyframes rise { 0% { transform: translate(0, 0); opacity: 0; } 15% { opacity: .9; } 100% { transform: translate(14px, -260px); opacity: 0; } }"""
    grad = '<linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FF4F8B"/><stop offset=".25" stop-color="#FF7A3D"/><stop offset=".5" stop-color="#E5A800"/><stop offset=".75" stop-color="#22A779"/><stop offset="1" stop-color="#7A4DFF"/></linearGradient>'
    card("relay-holi.svg", "Happy Holi from Relay", "Happy Holi", ("#FFF8EF", "#FFEFF6"), "url(#rainbow)",
         "May your days be as colourful as your diffs", "#6B4A7A", body, css, grad)


# Christmas: snow falls, Relay wears a Santa hat, snowy ground
SANTA_HAT = (f'<g transform="rotate(-10 250 30)">'
             f'<path d="M188 40C200 -20 250 -70 318 -62C352 -58 372 -40 376 -18C350 -34 326 -30 314 -4L312 36Z" fill="#E23A3A" stroke="{NAVY}" stroke-width="7" stroke-linejoin="round"/>'
             f'<rect x="178" y="22" width="150" height="34" rx="17" fill="#FFFFFF" stroke="{NAVY}" stroke-width="7"/>'
             f'<circle cx="378" cy="-16" r="18" fill="#FFFFFF" stroke="{NAVY}" stroke-width="7"/></g>')


def christmas():
    snow = falling(46, lambda r, c: f'<circle r="{r.uniform(2, 5):.1f}" fill="#FFFFFF" opacity="{r.uniform(.6, 1):.2f}"/>', 21, ["#fff"])
    ground = ('<path d="M0 410C120 380 220 400 300 392C400 382 480 404 600 390V470H0Z" fill="#EAF2FF"/>'
              '<path d="M0 410C120 380 220 400 300 392C400 382 480 404 600 390" fill="none" stroke="#C9DBF5" stroke-width="3"/>')
    tree = ('<g transform="translate(70 300)"><path d="M0 -70L34 -10H18L44 40H-44L-18 -10H-34Z" fill="#1F8A5B"/><rect x="-7" y="40" width="14" height="18" fill="#8A5A32"/>'
            '<circle cx="-10" cy="0" r="4" fill="#FFD166" class="twinkle"/><circle cx="14" cy="20" r="4" fill="#FF7AA2" class="twinkle" style="animation-delay:.6s"/>'
            '<circle cx="-18" cy="30" r="4" fill="#7FB4FF" class="twinkle" style="animation-delay:1.2s"/><path d="M0 -84l5 10 11 1-8 7 3 11-11-6-11 6 3-11-8-7 11-1z" fill="#FFD166"/></g>')
    body = ground + tree + relay_at("c", 150, 150, .72, FACE("happy", "big"), SANTA_HAT) + snow
    css = """
    .fall { animation: fall linear infinite; }
    .twinkle { animation: twinkle 1.8s ease-in-out infinite; }
    @keyframes fall { from { transform: translate(0, 0); } to { transform: translate(18px, 510px); } }
    @keyframes twinkle { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }"""
    card("relay-christmas.svg", "Merry Christmas from Relay", "Merry Christmas", ("#0E2149", "#1D3B78"), "#FFFFFF",
         "Peace, joy and a clean working tree", "#22335A", body, css, sub_y=446)


# New Year: confetti falls, party hat, "2027" pops in
PARTY_HAT = (f'<g transform="rotate(12 250 20)">'
             f'<path d="M200 34L256 -78L312 30Z" fill="#7A4DFF" stroke="{NAVY}" stroke-width="7" stroke-linejoin="round"/>'
             f'<path d="M228 -22L284 -8M214 8L298 22M242 -50L270 -42" stroke="#FFD166" stroke-width="9" stroke-linecap="round"/>'
             f'<circle cx="256" cy="-84" r="15" fill="#FF7AA2" stroke="{NAVY}" stroke-width="6"/></g>')


def new_year(year="2027"):
    conf = falling(40, lambda r, c: f'<rect x="-6" y="-3" width="{r.uniform(9, 14):.0f}" height="6" rx="2" fill="{c}" transform="rotate({r.uniform(0, 180):.0f})"/>',
                   33, ["#FFD166", "#FF7AA2", "#7EE0C3", "#7FB4FF", "#B892FF"], dmin=4, dmax=8)
    big = (f'<text x="300" y="128" text-anchor="middle" font-family="{TITLE_FONT}" font-size="56" font-weight="900" fill="url(#gold2)" '
           f'class="pop" style="transform-origin:300px 110px">{year}</text>')
    body = big + relay_at("n", 156, 196, .62, FACE("excited", "big"), PARTY_HAT, spark=GOLD) + conf
    css = """
    .fall { animation: fall linear infinite; }
    .pop { animation: pop 2.6s ease-in-out infinite; }
    @keyframes fall { from { transform: translate(0, 0) rotate(0deg); } to { transform: translate(-30px, 510px) rotate(540deg); } }
    @keyframes pop { 0%, 100% { transform: scale(1); } 12% { transform: scale(1.12); } 24% { transform: scale(1); } }"""
    grad = '<linearGradient id="gold2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0B8"/><stop offset="1" stop-color="#F2B33D"/></linearGradient>'
    card("relay-new-year.svg", f"Happy New Year {year} from Relay", "Happy New Year", ("#120B33", "#3A1F6B"), "#FFFFFF",
         "New year, fresh commits", "#E9DDFB", body, css, grad, title_y=62)


# Eid: crescent moon and star, swinging lanterns
def lantern(x, length, colour, delay):
    return (f'<g class="swing" style="transform-origin:{x}px 0px;animation-delay:{delay}s">'
            f'<path d="M{x} 0V{length}" stroke="#E8C77A" stroke-width="2"/>'
            f'<g transform="translate({x} {length})">'
            f'<path d="M-10 0h20l6 10H-16z" fill="#E8C77A"/>'
            f'<path d="M-16 10h32c4 14 4 30 0 44H-16c-4-14-4-30 0-44z" fill="{colour}" stroke="#E8C77A" stroke-width="3"/>'
            f'<path d="M0 14v36M-9 16c-3 12-3 24 0 36M9 16c3 12 3 24 0 36" stroke="#FFE7A3" stroke-width="2" opacity=".8"/>'
            f'<circle cx="0" cy="32" r="16" fill="#FFD27A" opacity=".35" class="glow"/>'
            f'<path d="M-16 54h32l-6 8h-20z" fill="#E8C77A"/><path d="M0 62v10" stroke="#E8C77A" stroke-width="3" stroke-linecap="round"/></g></g>')


def eid():
    moon = ('<g class="glow"><circle cx="500" cy="120" r="46" fill="#FFE7A3"/><circle cx="520" cy="104" r="40" fill="url(#skyfill)"/></g>'
            '<path d="M454 72l4 9 10 1-8 6 3 10-9-5-9 5 3-10-8-6 10-1z" fill="#FFE7A3" class="twinkle"/>')
    rnd = random.Random(5)
    stars = "".join(f'<circle cx="{rnd.uniform(20, 580):.0f}" cy="{rnd.uniform(110, 300):.0f}" r="{rnd.uniform(1.5, 2.8):.1f}" fill="#FFF4D6" class="twinkle" style="animation-delay:{rnd.uniform(0, 2):.1f}s"/>' for _ in range(16))
    lanterns = lantern(70, 60, "#2BA58A", 0) + lantern(130, 110, "#C2416B", .5) + lantern(560, 40, "#3D6FD8", .9) + lantern(470, 230, "#B8862B", .3)
    body = stars + moon + lanterns + relay_at("e", 150, 150, .72, FACE("happy", "big"))
    css = """
    .swing { animation: swing 3s ease-in-out infinite alternate; }
    .glow { animation: glow 2.4s ease-in-out infinite alternate; }
    .twinkle { animation: twinkle 2.2s ease-in-out infinite; }
    @keyframes swing { from { transform: rotate(-5deg); } to { transform: rotate(5deg); } }
    @keyframes glow { from { opacity: .7; } to { opacity: 1; } }
    @keyframes twinkle { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }"""
    grad = '<linearGradient id="skyfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B3B45"/><stop offset="1" stop-color="#0E4A55"/></linearGradient>'
    card("relay-eid.svg", "Eid Mubarak from Relay", "Eid Mubarak", ("#0A3540", "#145A63"), "#FFE7A3",
         "Wishing you peace, joy and blessings", "#D8F3EE", body, css, grad, title_y=64)


# Halloween: Relay is already a ghost. Bats flap, the pumpkin glows
def bat(x, y, s, delay):
    return (f'<g class="bob" style="animation-delay:{delay}s"><g transform="translate({x} {y}) scale({s})">'
            f'<g class="flap" style="animation-delay:{delay}s"><path d="M0 0C-10 -14 -26 -18 -40 -10C-32 -6 -30 2 -34 8C-24 2 -16 4 -10 10C-8 4 -4 2 0 4C4 2 8 4 10 10C16 4 24 2 34 8C30 2 32 -6 40 -10C26 -18 10 -14 0 0Z" fill="#1A1033"/></g>'
            f'<circle cx="-3" cy="-1" r="1.6" fill="#FFB547"/><circle cx="3" cy="-1" r="1.6" fill="#FFB547"/></g></g>')


def halloween():
    pumpkin = ('<g transform="translate(470 392)"><ellipse cx="0" cy="0" rx="60" ry="46" fill="#F07A1A" stroke="#7A3208" stroke-width="5"/>'
               '<path d="M-20 -44C-26 -10 -26 20 -18 44M20 -44C26 -10 26 20 18 44" fill="none" stroke="#C25A0E" stroke-width="4"/>'
               '<path d="M-4 -46c0-10 4-16 12-20" fill="none" stroke="#4E7A2A" stroke-width="7" stroke-linecap="round"/>'
               '<g class="glow"><path d="M-30 -10l12-12 10 12zM8 -10l12-12 10 12z" fill="#FFE07A"/>'
               '<path d="M-34 12c14 16 54 16 68 0l-8 2-6 8-8-6-8 8-8-8-8 6-6-8z" fill="#FFE07A"/></g></g>')
    moon = '<circle cx="90" cy="130" r="40" fill="#FFE9B0" opacity=".9"/>'
    bats = bat(150, 150, 1, 0) + bat(500, 170, .8, .7) + bat(420, 120, .6, 1.3)
    boo = (f'<text x="96" y="300" font-family="{TITLE_FONT}" font-size="34" font-weight="900" fill="#FFFFFF" '
           f'class="boo" transform="rotate(-12 96 300)">Boo!</text>')
    body = moon + bats + pumpkin + boo + relay_at("w", 150, 140, .72, FACE("surprised", "o"))
    css = """
    .bob { animation: bob 2.6s ease-in-out infinite; }
    .flap { transform-box: fill-box; transform-origin: center; animation: flap .35s ease-in-out infinite alternate; }
    .glow { animation: glow 1.4s ease-in-out infinite alternate; }
    .boo { animation: boo 2.4s ease-in-out infinite; }
    @keyframes bob { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-14px, -12px); } }
    @keyframes flap { from { transform: scaleY(1); } to { transform: scaleY(.45); } }
    @keyframes glow { from { opacity: .65; } to { opacity: 1; } }
    @keyframes boo { 0%, 60%, 100% { opacity: 0; } 70%, 90% { opacity: 1; } }"""
    card("relay-halloween.svg", "Happy Halloween from Relay", "Happy Halloween", ("#1B0F33", "#4A1F4F"), "#FFB547",
         "No scary merges tonight", "#F3DDF0", body, css, title_y=70)


# Syncing: a loading animation for the product. Relay ferries a file from your
# folder to the repo, then flies back for the next one.
def syncing():
    W, H = 600, 290
    folder = lambda x, colour, label_text: (
        f'<g transform="translate({x} 150)"><path d="M-46 -34a8 8 0 0 1 8-8h26l10 10h40a8 8 0 0 1 8 8v58a8 8 0 0 1-8 8h-76a8 8 0 0 1-8-8z" fill="{colour}" stroke="{NAVY}" stroke-width="5" stroke-linejoin="round"/>'
        f'<path d="M-46 -18h92" stroke="{NAVY}" stroke-width="5" opacity=".25"/></g>'
        f'<text x="{x}" y="226" text-anchor="middle" font-family="{BODY_FONT}" font-size="15" font-weight="600" fill="{NAVY}">{label_text}</text>')
    doc = (f'<g class="doc"><rect x="-14" y="-18" width="28" height="36" rx="4" fill="#FFFFFF" stroke="{NAVY}" stroke-width="4"/>'
           f'<path d="M-7 -8h14M-7 0h14M-7 8h9" stroke="{NAVY}" stroke-width="3" stroke-linecap="round"/></g>')
    track = f'<path d="M150 52Q300 4 450 52" fill="none" stroke="#9BB4DC" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>'
    rider = (f'<g class="ferry"><g transform="translate(-58 -46) scale(.26)"><defs><clipPath id="sclip"><path d="{SIL}"/></clipPath></defs>'
             f'{figure("s", FACE("focused", "smirk"))}</g><g transform="translate(50 30) rotate(8)">{doc}</g></g>')
    css = """
    .ferry { animation: ferry 3.2s ease-in-out infinite; }
    .doc { animation: doc 3.2s linear infinite; }
    .dots circle { animation: dot 1.2s ease-in-out infinite; }
    @keyframes ferry {
      0% { transform: translate(150px, 52px) scaleX(1); }
      45% { transform: translate(450px, 52px) scaleX(1); }
      50% { transform: translate(450px, 52px) scaleX(-1); }
      95% { transform: translate(150px, 52px) scaleX(-1); }
      100% { transform: translate(150px, 52px) scaleX(1); } }
    @keyframes doc { 0%, 45% { opacity: 1; } 47%, 97% { opacity: 0; } 100% { opacity: 1; } }
    @keyframes dot { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } .ferry { transform: translate(300px, 30px); } }"""
    content = f'''<style>{css}
  </style>
  <rect width="{W}" height="{H}" rx="24" fill="#F4F7FC"/>
  {track}
  {folder(150, "#FFD27A", "your folder")}
  {folder(450, "#9BC9FF", "repo")}
  {rider}
  <text x="300" y="266" text-anchor="middle" font-family="{TITLE_FONT}" font-size="20" font-weight="800" fill="{NAVY}">Syncing</text>
  <g class="dots">{"".join(f'<circle cx="{352 + i * 11}" cy="261" r="3" fill="{NAVY}" style="animation-delay:{i * .2}s"/>' for i in range(3))}</g>'''
    open(os.path.join(out, "relay-syncing.svg"), "w").write(svg(content, (0, 0, W, H), label="Relay syncing your files", title="Syncing"))


holi()
christmas()
new_year()
eid()
halloween()
syncing()
print("wrote 6 more animated cards")


# ---------- Diwali variants ----------
DIWALI_DEFS = '''<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset="1" stop-color="#F2B33D"/></linearGradient>
    <linearGradient id="clay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9783A"/><stop offset="1" stop-color="#9C4219"/></linearGradient>
    <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FF7A1A"/><stop offset=".55" stop-color="#FFB627"/><stop offset="1" stop-color="#FFE57A"/></linearGradient>
    <radialGradient id="glowA"><stop offset="0" stop-color="#FFC94D" stop-opacity=".75"/><stop offset="1" stop-color="#FFC94D" stop-opacity="0"/></radialGradient>'''
DIYA_CSS = """
    .flame { transform-box: fill-box; transform-origin: 50% 100%; animation: flicker .9s ease-in-out infinite alternate; }
    .glow { animation: glow 1.8s ease-in-out infinite alternate; }
    .twinkle { animation: twinkle 2.2s ease-in-out infinite; }
    @keyframes flicker { 0% { transform: scale(1, 1) skewX(0deg); } 50% { transform: scale(.94, 1.08) skewX(-3deg); } 100% { transform: scale(1.04, .95) skewX(3deg); } }
    @keyframes glow { from { opacity: .55; } to { opacity: 1; } }
    @keyframes twinkle { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }"""


def stars_(seed, n, ymax=300):
    rnd = random.Random(seed)
    return "".join(f'<circle cx="{rnd.uniform(20, 580):.0f}" cy="{rnd.uniform(20, ymax):.0f}" r="{rnd.uniform(1.4, 2.8):.1f}" fill="#FFF4D6" '
                   f'class="twinkle" style="animation-delay:{rnd.uniform(0, 2.2):.1f}s"/>' for _ in range(n))


# 1. Rangoli that draws itself on the floor
def diwali_rangoli():
    cx, cy = 300, 404
    def petals(n, r_in, r_out, width, colour, delay):
        out = ""
        for k in range(n):
            a = 360 * k / n
            out += (f'<path d="M0 {-r_in}C{width} {-(r_in + r_out) / 2} {width * .6} {-r_out + 6} 0 {-r_out}C{-width * .6} {-r_out + 6} {-width} {-(r_in + r_out) / 2} 0 {-r_in}Z" '
                    f'transform="rotate({a:.1f})" pathLength="1" fill="{colour}" stroke="#FFF1C9" stroke-width="2.5" class="draw" style="animation-delay:{delay + k * .06:.2f}s"/>')
        return out
    dots = "".join(f'<circle cx="{150 * math.cos(2 * math.pi * k / 24):.1f}" cy="{150 * math.sin(2 * math.pi * k / 24):.1f}" r="5" fill="#FFE7A3" class="dot" style="animation-delay:{1.6 + k * .03:.2f}s"/>' for k in range(24))
    rangoli = (f'<g transform="translate({cx} {cy}) scale(1 .42)">'
               f'<circle r="168" fill="none" stroke="#FFB547" stroke-width="4" pathLength="1" class="draw" style="animation-delay:0s"/>'
               + petals(16, 92, 140, 22, "#E8336B", .2) + petals(12, 52, 96, 20, "#FFB627", .9) + petals(8, 18, 56, 16, "#2BB5A0", 1.4)
               + f'<circle r="18" fill="#7A3DD8" stroke="#FFF1C9" stroke-width="3" pathLength="1" class="draw" style="animation-delay:1.8s"/>'
               + dots + '</g>')
    diyas = "".join(diya(x, y, .5, d, "glowA") for x, y, d in [(120, 404, 0), (480, 404, .4), (300, 462, .8)])
    body = stars_(8, 14, 200) + rangoli + diyas + relay_at("r", 165, 112, .6, FACE("happy", "big"))
    css = DIYA_CSS + """
    .draw { stroke-dasharray: 1; stroke-dashoffset: 1; fill-opacity: 0; animation: draw 8s ease-in-out infinite; }
    .dot { opacity: 0; animation: dotin 8s ease-in-out infinite; }
    @keyframes draw { 0% { stroke-dashoffset: 1; fill-opacity: 0; } 18% { stroke-dashoffset: 0; fill-opacity: 0; } 30%, 86% { stroke-dashoffset: 0; fill-opacity: 1; } 96%, 100% { stroke-dashoffset: 0; fill-opacity: 0; opacity: 0; } }
    @keyframes dotin { 0%, 20% { opacity: 0; } 30%, 86% { opacity: 1; } 96%, 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .draw { stroke-dashoffset: 0; fill-opacity: 1; } .dot { opacity: 1; } }"""
    card("relay-diwali-rangoli.svg", "Happy Diwali from Relay: rangoli", "Happy Diwali", ("#3A0A22", "#6A1838"), "url(#gold)",
         "May every pattern in your life fall into place", "#FBE3EC", body, css, DIWALI_DEFS, title_y=70, sub_y=104, H=500)


# 2. Sky lanterns rising into the night
def sky_lantern(x, scale, colour):
    return (f'<g transform="translate({x} 0) scale({scale})">'
            f'<ellipse cx="0" cy="-10" rx="40" ry="50" fill="url(#lglow)"/>'
            f'<path d="M-22 -34h44l8 50h-60z" fill="{colour}" stroke="#7A2E0E" stroke-width="2.5" stroke-linejoin="round"/>'
            f'<path d="M-11 -34l-3 50M11 -34l3 50" stroke="#7A2E0E" stroke-width="1.5" opacity=".5"/>'
            f'<ellipse cx="0" cy="12" rx="9" ry="5" fill="#FFF3B0"/></g>')


LOOP = 12  # seconds


def diwali_lanterns():
    rnd = random.Random(42)
    lanterns = ""
    for i in range(9):
        x = rnd.uniform(60, 540)
        if 210 < x < 390:  # keep Relay's space clear at the start
            x = rnd.choice([rnd.uniform(60, 200), rnd.uniform(400, 540)])
        # every motion in this card repeats on a 12 s cycle, so it loops seamlessly as a video or GIF
        dur = LOOP
        lanterns += (f'<g class="rise" style="animation-duration:{dur}s;animation-delay:-{(i + rnd.uniform(0, .6)) * dur / 9:.2f}s"><g transform="translate(0 520)">'
                     f'<g class="sway" style="animation-delay:{rnd.uniform(0, 2):.1f}s">{sky_lantern(x, rnd.uniform(.55, 1), rnd.choice(["#FF9A3C", "#FFB547", "#FF7A45"]))}</g></g></g>')
    # Relay lets one go
    own = f'<g class="rise-own"><g transform="translate(0 0)">{sky_lantern(300, .9, "#FFB547")}</g></g>'
    body = stars_(3, 26, 380) + lanterns + own + relay_at("l", 156, 230, .64, FACE("happy", "big"))  # Relay's lantern rises from behind it
    css = DIYA_CSS + """
    .rise { animation: rise linear infinite; }
    .rise-own { animation: own 12s ease-in infinite; }
    .sway { animation: sway 3s ease-in-out infinite alternate; }
    .float { animation-duration: 4s; }
    .twinkle { animation-duration: 2s; }
    @keyframes rise { from { transform: translateY(0); opacity: 1; } 85% { opacity: 1; } to { transform: translateY(-600px); opacity: 0; } }
    @keyframes own { 0% { transform: translateY(250px); opacity: 0; } 8% { opacity: 1; } 100% { transform: translateY(-120px); opacity: 0; } }
    @keyframes sway { from { transform: translateX(-6px); } to { transform: translateX(6px); } }
    @media (prefers-reduced-motion: reduce) { .rise-own { transform: translateY(150px); } }"""
    defs_ = DIWALI_DEFS + '<radialGradient id="lglow"><stop offset="0" stop-color="#FFC94D" stop-opacity=".55"/><stop offset="1" stop-color="#FFC94D" stop-opacity="0"/></radialGradient>'
    card("relay-diwali-lanterns.svg", "Happy Diwali from Relay: sky lanterns", "Happy Diwali", ("#0B1236", "#24205A"), "url(#gold)",
         "May your wishes rise and your builds stay green", "#E6E3FB", body, css, defs_, title_y=70, sub_y=104)


# 3. A sparkler (phuljhadi)
def diwali_sparkler():
    tip = (482, 70)  # in Relay's coordinates
    rnd = random.Random(9)
    sparks = ""
    for k in range(18):
        a = 2 * math.pi * k / 18 + rnd.uniform(-.12, .12)
        r1, r2 = rnd.uniform(10, 18), rnd.uniform(46, 80)
        c = rnd.choice(["#FFF3B0", "#FFD166", "#FFB627"])
        sparks += (f'<path d="M{tip[0] + r1 * math.cos(a):.1f} {tip[1] + r1 * math.sin(a):.1f}L{tip[0] + r2 * math.cos(a):.1f} {tip[1] + r2 * math.sin(a):.1f}" '
                   f'stroke="{c}" stroke-width="4" stroke-linecap="round" class="spark" style="animation-delay:{rnd.uniform(0, .6):.2f}s;animation-duration:{rnd.uniform(.35, .7):.2f}s"/>')
    flying = ""
    for k in range(10):
        a = rnd.uniform(0, 2 * math.pi)
        d = rnd.uniform(70, 120)
        flying += (f'<circle cx="{tip[0]}" cy="{tip[1]}" r="3.5" fill="#FFE57A" class="fly" '
                   f'style="--dx:{d * math.cos(a):.0f}px;--dy:{d * math.sin(a):.0f}px;animation-delay:{rnd.uniform(0, 1.2):.2f}s"/>')
    stick = (f'<path d="M400 236L{tip[0]} {tip[1]}" stroke="#6B6F7A" stroke-width="7" stroke-linecap="round"/>'
             f'<path d="M430 176L{tip[0]} {tip[1]}" stroke="#3A3D45" stroke-width="9" stroke-linecap="round"/>'
             f'<circle cx="{tip[0]}" cy="{tip[1]}" r="22" fill="url(#glowA)" class="glow"/><circle cx="{tip[0]}" cy="{tip[1]}" r="8" fill="#FFF8D6"/>')
    body = stars_(12, 18, 420) + relay_at("k", 120, 150, .7, FACE("excited", "big"), stick + sparks + flying)
    css = DIYA_CSS + """
    .spark { animation: spark .5s ease-in-out infinite alternate; transform-box: fill-box; transform-origin: center; }
    .fly { animation: fly 1.4s ease-out infinite; }
    @keyframes spark { from { opacity: .15; } to { opacity: 1; } }
    @keyframes fly { 0% { transform: translate(0, 0); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)); opacity: 0; } }"""
    card("relay-diwali-sparkler.svg", "Happy Diwali from Relay: sparkler", "Happy Diwali", ("#140D2E", "#2B1A4F"), "url(#gold)",
         "Sparkle on! May every commit shine", "#E9DDFB", body, css, DIWALI_DEFS, title_y=70, sub_y=446)


# 4. A row of diyas lighting up one by one, greeting in Hindi
def diwali_diyas():
    n = 7
    row = ""
    for i in range(n):
        t = i / (n - 1)
        x = 70 + t * 460
        y = 400 + 30 * math.sin(math.pi * t)
        row += (f'<g transform="translate({x:.0f} {y:.0f}) scale(.62)">'
                f'<circle cx="0" cy="-30" r="46" fill="url(#glowA)" class="light" style="animation-delay:{i * .45:.2f}s"/>'
                f'<path d="M-46 0C-40 30 40 30 46 0Z" fill="url(#clay)" stroke="#5A2A12" stroke-width="4" stroke-linejoin="round"/>'
                f'<path d="M-46 0C-20 -10 20 -10 46 0" fill="none" stroke="#F3B35C" stroke-width="5" stroke-linecap="round"/>'
                f'<g class="light" style="animation-delay:{i * .45:.2f}s"><g class="flame"><path d="M0 -6C-14 -18 -12 -34 0 -54C12 -34 14 -18 0 -6Z" fill="url(#flame)"/>'
                f'<path d="M0 -10C-6 -18 -5 -26 0 -34C5 -26 6 -18 0 -10Z" fill="#FFF6C9"/></g></g></g>')
    body = stars_(4, 16, 200) + relay_at("y", 156, 140, .64, FACE("happy", "big")) + row
    css = DIYA_CSS + """
    .light { opacity: 0; animation: light 7s ease-in-out infinite; }
    @keyframes light { 0% { opacity: 0; } 6%, 82% { opacity: 1; } 92%, 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .light { opacity: 1; } }"""
    deva = "'Kohinoor Devanagari', 'Noto Sans Devanagari', 'Nirmala UI', 'Devanagari Sangam MN', Mangal, sans-serif"
    card("relay-diwali-diyas.svg", "Shubh Deepavali from Relay", "शुभ दीपावली", ("#1A0E2E", "#3A1C3F"), "url(#gold)",
         "Shubh Deepavali · wishing you light, joy and prosperity", "#F3E3F4", body, css, DIWALI_DEFS, title_y=74, sub_y=110,
         title_font=deva, title_size=48)


# 5. Sweets: a plate of ladoos
def diwali_sweets():
    rnd = random.Random(2)
    def ladoo(x, y, r, delay):
        dots = "".join(f'<circle cx="{x + rnd.uniform(-r * .6, r * .6):.1f}" cy="{y + rnd.uniform(-r * .6, r * .6):.1f}" r="1.6" fill="#C9661A" opacity=".7"/>' for _ in range(7))
        return (f'<g class="bounce" style="animation-delay:{delay:.2f}s"><circle cx="{x}" cy="{y}" r="{r}" fill="url(#ladoo)" stroke="#9C4A12" stroke-width="3"/>{dots}'
                f'<ellipse cx="{x - r * .35:.1f}" cy="{y - r * .4:.1f}" rx="{r * .3:.1f}" ry="{r * .18:.1f}" fill="#FFE2A8" opacity=".8"/></g>')
    pile = [(-60, 0), (-20, 0), (20, 0), (60, 0), (-40, -34), (0, -34), (40, -34), (-20, -66), (20, -66), (0, -98)]
    ladoos = "".join(ladoo(300 + dx, 392 + dy, 22, i * .18) for i, (dx, dy) in enumerate(pile))
    plate = ('<ellipse cx="300" cy="420" rx="150" ry="26" fill="#D9DEE8" stroke="#8B93A6" stroke-width="4"/>'
             '<ellipse cx="300" cy="414" rx="124" ry="16" fill="#EEF1F6"/>')
    sparkle_ = "".join(f'<path d="M{x} {y - 10}l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#FFD166" class="twinkle" style="animation-delay:{d}s"/>'
                       for x, y, d in [(150, 330, 0), (452, 320, .7), (190, 250, 1.3), (420, 240, .4), (110, 410, 1.6), (494, 410, 1)])
    body = sparkle_ + relay_at("w", 150, 92, .66, FACE("love", "big")) + plate + ladoos
    css = DIYA_CSS + """
    .bounce { animation: bounce 2.8s ease-in-out infinite; }
    @keyframes bounce { 0%, 20%, 100% { transform: translateY(0); } 8% { transform: translateY(-10px); } }"""
    defs_ = DIWALI_DEFS + '<radialGradient id="ladoo" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FFC56B"/><stop offset="1" stop-color="#F08A1E"/></radialGradient>'
    card("relay-diwali-sweets.svg", "Sweet Diwali from Relay", "Sweet Diwali", ("#FFF3E2", "#FFE1EA"), "#C2410C",
         "May your merges be as sweet as ladoos", "#7A3B2A", body, css, defs_, title_y=64, sub_y=460, H=480)


diwali_rangoli()
diwali_lanterns()
diwali_sparkler()
diwali_diyas()
diwali_sweets()
print("wrote 5 Diwali variants")


# ---------- comparing: Relay looks from one file to the other ----------
# Used by the web app while files are compared by content.
def comparing_anim():
    W, H = 360, 170
    def doc(x, cls):
        lines = "".join(f'<path d="M{x + 12} {y}h{w}" stroke="#B9C6DD" stroke-width="4" stroke-linecap="round"/>' for y, w in [(80, 28), (92, 24), (104, 28), (116, 18)])
        return (f'<g><rect x="{x - 6}" y="52" width="64" height="86" rx="12" fill="{SPARK}" opacity=".0" class="{cls}"/>'
                f'<rect x="{x}" y="58" width="52" height="74" rx="8" fill="#FFFFFF" stroke="{NAVY}" stroke-width="4"/>{lines}'
                f'<rect x="{x + 6}" y="66" width="40" height="5" rx="2.5" fill="{SPARK}" class="scan"/></g>')
    face = f'<g class="look">{eyes("open")}</g>' + mouth("small") + cheek()
    relay = (f'<g class="float"><g transform="translate(95 22) scale(.38)"><defs><clipPath id="cmpclip"><path d="{SIL}"/></clipPath></defs>'
             f'{figure("cmp", face)}</g></g>')
    css = """
    .float { animation: float 3s ease-in-out infinite; }
    .look { animation: look 3s ease-in-out infinite; }
    .scan { animation: scan 1.5s ease-in-out infinite alternate; }
    .seeL { animation: seeL 3s ease-in-out infinite; }
    .seeR { animation: seeR 3s ease-in-out infinite; }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
    @keyframes look { 0%, 38% { transform: translateX(-16px); } 50%, 88% { transform: translateX(16px); } 100% { transform: translateX(-16px); } }
    @keyframes scan { from { transform: translateY(0); } to { transform: translateY(56px); } }
    @keyframes seeL { 0%, 38% { opacity: .35; } 50%, 88% { opacity: 0; } 100% { opacity: .35; } }
    @keyframes seeR { 0%, 38% { opacity: 0; } 50%, 88% { opacity: .35; } 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }"""
    content = f'''<style>{css}
  </style>
  {doc(18, "seeL")}
  {doc(290, "seeR")}
  {relay}'''
    open(os.path.join(out, "relay-comparing.svg"), "w").write(svg(content, (0, 0, W, H), label="Relay comparing two files", title="Comparing"))


comparing_anim()
print("wrote relay-comparing.svg")
