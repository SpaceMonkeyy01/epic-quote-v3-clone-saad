"""
Sign-type MATRIX generator  (v1 — Epic Craftings wizard redesign)
=================================================================
Model:  base sign type  ×  mounting  ->  one normalized SPECIFICATIONS block.

WHY this shape: the boss's "FA" sheet defines each channel-letter type across a fixed
set of mountings. Instead of storing 6 hand-written spec blocks per type (the source of
the RACEWAY-COLOR-on-a-backer bug, missing FINISH lines, and label drift), we store the
base type ONCE + a shared mounting overlay, and GENERATE every combo. Self-consistent by
construction.

Inputs are seeded verbatim from the sheet's filled rows (HALO LIT, FACE LIT). Each new
version of the sheet just adds BASE_TYPES rows; re-run to regenerate.

Outputs (docs/sign-matrix/):
  - generated_specs_preview.html   human review — every combo, grouped, with package image
  - matrix.json                    machine form that will feed catalog.js when wired live
Run:  python docs/sign-matrix/build_matrix.py
"""
import json, os, html

HERE = os.path.dirname(os.path.abspath(__file__))

# ── The mounting overlay (derived from the filled HALO + FACE rows) ─────────────────
# Each mounting swaps in a MOUNTING line, an optional structure line, and an optional
# extra colour. `mount_line=None` on Flush means "use the base type's own flush line"
# (halo stud-mounts for the halo gap; face-lit flush-mounts) — the one legit per-type diff.
MOUNTINGS = [
    {"key": "flush",     "sheet": "Flush Mount",                 "suffix": "",
     "mount_line": None, "structure": None,                                   "extra_color": None},
    {"key": "raceway2",  "sheet": "Raceway Mount (2\")",          "suffix": " WITH RACEWAY",
     "mount_line": "RACEWAY MOUNT", "structure": 'RACEWAY: 2" DEEP, 6" TALL ALUMINUM RACEWAY',
     "extra_color": "RACEWAY COLOR"},
    {"key": "backboard2", "sheet": "Backboard Cabinet (2\")",     "suffix": " WITH BACKBOARD",
     "mount_line": "BACKER MOUNT", "structure": 'BACKER: 2" DEEP ALUMINUM BACKER',
     "extra_color": "BACKER COLOR"},
    {"key": "flat_al",   "sheet": "Flat Aluminum Backer (2.5 mm)", "suffix": " WITH FLAT ALUMINUM BACKER",
     "mount_line": "BACKER MOUNT", "structure": "BACKER: 2.5MM FLAT ALUMINUM BACKER",
     "extra_color": "BACKER COLOR"},
    {"key": "flat_acm",  "sheet": "Flat ACM Backer (4mm)",        "suffix": " WITH ACM BACKER",
     "mount_line": "BACKER MOUNT", "structure": "BACKER: 4MM ACM BACKER",
     "extra_color": "BACKER COLOR"},
    {"key": "flat_acr",  "sheet": "Flat Acrylic Backer (8mm)",    "suffix": " WITH ACRYLIC BACKER",
     "mount_line": "BACKER MOUNT", "structure": "BACKER: 8MM ACRYLIC BACKER",
     "extra_color": "BACKER COLOR"},
]

# ── Base types (seeded verbatim from the sheet's filled rows). Extend per version. ──
#   colors  = the base colour rows (all [ASK REP] here); mounting adds its own colour.
#   flush   = the MOUNTING line used for the Flush option specifically.
#   mounts  = which mounting keys this base type actually offers (v1: all 6 for these two).
BASE_TYPES = [
    {
        "group": "CHANNEL LETTERS", "name": "HALO LIT CHANNEL LETTERS",
        "face": "SS/ALUMINUM FACE", "trim": None,
        "illum": "6500K LED MODULES (3 YEAR WARRANTY)",
        "colors": ["FACE & RETURN COLOR"], "flush": "STUD MOUNT",
        "package": "A", "mounts": [m["key"] for m in MOUNTINGS],
        "legacy": {  # old catalog sub-type name -> (this base, mounting) so saved quotes still open
            "HALO LIT CHANNEL LETTERS": "flush",
            "HALO LIT CHANNEL LETTERS WITH RACEWAY": "raceway2",
            "HALO LIT CHANNEL LETTERS WITH BACKER": "backboard2",
            "HALO LIT CHANNEL LETTERS WITH ACM BACKER": "flat_acm",
        },
    },
    {
        "group": "CHANNEL LETTERS", "name": "FACE LIT CHANNEL LETTERS",
        "face": "ACRYLIC FACE WITH VINYL APPLICATION", "trim": "METALLIC/STANDARD TRIM CAP",
        "illum": "6500K LED MODULES (3 YEAR WARRANTY)",
        "colors": ["FACE COLOR", "RETURN & TRIM COLOR"], "flush": "FLUSH MOUNT",
        "package": "A", "mounts": [m["key"] for m in MOUNTINGS],
        "legacy": {
            "FACE LIT CHANNEL LETTERS": "flush",
            "FACE LIT CHANNEL LETTERS WITH RACEWAY": "raceway2",
            "FACE LIT CHANNEL LETTERS WITH BACKER": "backboard2",
            "FACE LIT CHANNEL LETTERS WITH ACM BACKER": "flat_acm",
        },
    },
]

MOUNT = {m["key"]: m for m in MOUNTINGS}

def generate_spec(base, m):
    """Normalized SPECIFICATIONS block, sheet order, uniform labels."""
    L = []
    L.append("SIGN TYPE: " + base["name"] + m["suffix"])
    L.append("FACE: " + base["face"])
    L.append('OVERALL DIMENSIONS: [HEIGHT]" X [WIDTH]"')
    L.append('RETURNS: [DEPTH]"')
    if base["trim"]:
        L.append("TRIM CAP: " + base["trim"])
    L.append("ILLUMINATED: " + base["illum"])
    L.append("MOUNTING: " + (m["mount_line"] or base["flush"]))
    if m["structure"]:
        L.append(m["structure"])
    L.append("COLOR SPECS:")
    colors = list(base["colors"]) + ([m["extra_color"]] if m["extra_color"] else [])
    for c in colors:
        L.append("  • " + c + ": [ASK REP]")
    L.append("FINISH: SATIN")
    L.append("APPLICATION: [APPLICATION]")
    return L

def build():
    combos, legacy_map = [], {}
    for base in BASE_TYPES:
        for key in base["mounts"]:
            m = MOUNT[key]
            combos.append({
                "group": base["group"], "base_type": base["name"],
                "mounting_key": key, "mounting": m["sheet"],
                "sign_type": base["name"] + m["suffix"],
                "package": base["package"], "spec": generate_spec(base, m),
            })
        for old, mk in base.get("legacy", {}).items():
            legacy_map[old] = {"base_type": base["name"], "mounting_key": mk}

    matrix = {"version": "v1", "mountings": MOUNTINGS,
              "base_types": [b["name"] for b in BASE_TYPES],
              "combos": combos, "legacy_alias": legacy_map}
    with open(os.path.join(HERE, "matrix.json"), "w", encoding="utf-8") as f:
        json.dump(matrix, f, indent=2, ensure_ascii=False)

    # ── HTML preview ──
    css = """body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1a2233;background:#f6f8fb}
h1{font-size:20px}h2{margin-top:28px;border-bottom:2px solid #d7deea;padding-bottom:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.card{background:#fff;border:1px solid #d7deea;border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(20,30,60,.06)}
.mt{font-weight:700;color:#2b3a55;margin-bottom:6px;font-size:13px}
.pkg{float:right;font-size:11px;background:#eef2f9;border:1px solid #d7deea;border-radius:6px;padding:1px 7px;color:#4a5876}
pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:#0d1526;color:#dce6f7;border-radius:8px;padding:10px;margin:0}
.hint{color:#5a6b8a}"""
    parts = [f"<!doctype html><meta charset=utf-8><title>Sign matrix preview v1</title><style>{css}</style>",
             "<h1>Sign-type × mounting — generated specs (v1 preview)</h1>",
             f"<p class=hint>{len(combos)} combos from {len(BASE_TYPES)} confirmed base types. "
             "Every block is generated from base fields + the shared mounting overlay — "
             "so labels, FINISH lines, and backer/raceway colours are uniform. "
             "Placeholders [HEIGHT]/[WIDTH]/[DEPTH]/[ASK REP]/[APPLICATION] fill per quote.</p>"]
    by_base = {}
    for c in combos:
        by_base.setdefault(c["base_type"], []).append(c)
    for base, cs in by_base.items():
        parts.append(f"<h2>{html.escape(base)}</h2><div class=grid>")
        for c in cs:
            spec = html.escape("\n".join(c["spec"]))
            parts.append(f"<div class=card><div class=mt>{html.escape(c['mounting'])}"
                         f"<span class=pkg>Package {c['package']}</span></div><pre>{spec}</pre></div>")
        parts.append("</div>")
    with open(os.path.join(HERE, "generated_specs_preview.html"), "w", encoding="utf-8") as f:
        f.write("".join(parts))
    return matrix

if __name__ == "__main__":
    m = build()
    print(f"generated {len(m['combos'])} combos from {len(m['base_types'])} base types")
    print(f"legacy aliases: {len(m['legacy_alias'])}")
    print("wrote matrix.json + generated_specs_preview.html")
    # echo HALO + FACE for immediate eyeball
    for c in m["combos"]:
        if c["mounting_key"] in ("flush", "backboard2"):
            print("\n=== " + c["sign_type"] + "  [Package " + c["package"] + "] ===")
            print("\n".join("   " + l for l in c["spec"]))
