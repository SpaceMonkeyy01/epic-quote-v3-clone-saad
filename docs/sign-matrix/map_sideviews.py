"""
Side-view mapper  —  'Estimator Side Views/' tree  ->  one PNG per catalog leaf
==============================================================================
    python docs/sign-matrix/map_sideviews.py "F:/Estimator Side Views-.../Estimator Side Views"

The boss ships side views as a folder tree whose levels mirror the FA sheet's own
question levels:

    <sign type>/[<trim cap>|<thickness>]/<mounting>/<anything>.png

This script matches each PNG to exactly ONE leaf of FA_SIGN_GROUPS, copies it into
backend/storage/app/public/side_views/<key>.png, and writes the key back into
faCatalogData.js so the wizard auto-selects the right diagram from the rep's answers.

It is deliberately strict: a PNG that matches no leaf, or a leaf with no PNG, is
reported as an ERROR rather than silently guessed. A wrong construction diagram on a
proposal is worse than a missing one, so ambiguity must fail loudly.

FOLDER-NAME DRIFT is expected and handled by normalisation, not by renaming the boss's
folders: `Backboard Cabinet (2_)` / `backboard cabinet 2 inch`, `Raceway Mount (2_)` /
`raceway ,mount 2 inch`, `Flat Acrylic Backer` / `flat acrylic backer 8mm`, and so on all
normalise to the same token. Sign-type names differ in a few places in ways no rule can
derive (`Flat Cut Acrylic Letters` vs the sheet's `Flat Cut Acrylic/PVC Letters`), so those
few live in SIGNTYPE_ALIAS below.

FLUSH vs STUD: the sheet calls the plain mounting `Stud Mount` for halo-lit and
`Flush Mount` elsewhere, while the folders use `Flush Mount` throughout. They are treated
as interchangeable ONLY for a sign type that does not offer both (flat-cut letters do, and
there they stay distinct).
"""
import json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
DATA_JS = os.path.join(ROOT, "frontend", "src", "generator", "faCatalogData.js")
# Served straight off the built frontend as /side_views/<key>.png (see svSrc in Proposal.jsx) —
# NOT from backend storage, which only holds rep-uploaded side views.
DEST = os.path.join(ROOT, "frontend", "public", "side_views")
SIDEVIEWS_JS = os.path.join(ROOT, "frontend", "src", "generator", "sideviews.js")

# Folder sign-type name -> FA sheet sign-type name, for the cases normalisation can't derive.
SIGNTYPE_ALIAS = {
    "FLATCUTACRYLICLETTERS": "FLATCUTACRYLICPVCLETTERS",
}


def norm_sign(s):
    s = re.sub(r"&", "AND", s.upper())
    s = re.sub(r"[^A-Z0-9]", "", s)
    return SIGNTYPE_ALIAS.get(s, s)


def norm_mount(s):
    """Mounting folder/sheet name -> canonical token. Order matters: VHB and Screws are
       both spelled 'Flush Mount (...)' in the sheet but are different diagrams."""
    t = s.lower()
    if "vhb" in t: return "vhb"
    if "screw" in t: return "flush"
    if "stud" in t: return "stud"
    if "flush" in t: return "flush"
    if "raceway" in t: return "raceway"
    if "backboard" in t or ("cabinet" in t and "2" in t): return "backboard"
    if "acm" in t: return "acm"
    if "acrylic" in t: return "acrylic"
    if "alumin" in t: return "aluminum"
    if "ceiling" in t: return "ceiling"
    # Neon: the folders say 'wall mount' where the sheet's option is 'Flush Mount' — its
    # own spec block prints MOUNTING: WALL MOUNTED, so these are the same choice.
    if "wall" in t: return "flush"
    return ""


def norm_thick(s):
    """'1-2_ thick' / '1/2\"' -> '1/2'"""
    t = s.lower().replace("thick", "").replace("_", "").replace('"', "").strip()
    t = t.replace("-", "/")
    return re.sub(r"\s+", "", t)


def norm_trim(s):
    return re.sub(r"[^A-Z]", "", s.upper())          # 'TRIMLESS' == 'TRIM LESS'


def slug(*parts):
    s = "-".join(p for p in parts if p)
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-+", "-", s)


# ── read the leaves out of the generated catalog (parsed, not eval'd) ──────────────
def load_leaves():
    src = open(DATA_JS, encoding="utf-8").read()
    groups, cur = [], None
    for line in src.split("\n"):
        m = re.match(r"\s*family: (\".*?\"), signtype: (\".*?\"),\s*$", line)
        if m:
            cur = {"family": json.loads(m.group(1)), "signtype": json.loads(m.group(2)), "leaves": []}
            groups.append(cur)
            continue
        m = re.match(r"\s*\{ trimcap: (\".*?\"), thickness: (\".*?\"), mounting: (\".*?\"), package: (\".*?\"), sideview:", line)
        if m and cur is not None:
            cur["leaves"].append({
                "trimcap": json.loads(m.group(1)), "thickness": json.loads(m.group(2)),
                "mounting": json.loads(m.group(3)), "raw": line,
            })
    return src, groups


def main(tree):
    src, groups = load_leaves()

    # index every leaf by (signtype, trim, thickness, mount)
    index, by_sign = {}, {}
    for g in groups:
        gs = norm_sign(g["signtype"])
        by_sign.setdefault(gs, []).append(g)
        for lf in g["leaves"]:
            k = (gs, norm_trim(lf["trimcap"]), norm_thick(lf["thickness"]), norm_mount(lf["mounting"]))
            index.setdefault(k, []).append((g, lf))

    pngs = []
    for dirpath, _dirs, files in os.walk(tree):
        for fn in files:
            if fn.lower().endswith(".png"):
                rel = os.path.relpath(os.path.join(dirpath, fn), tree).replace("\\", "/")
                pngs.append((rel, os.path.join(dirpath, fn)))
    pngs.sort()

    matched, errors, assigned = {}, [], {}
    for rel, full in pngs:
        parts = rel.split("/")[:-1]                        # drop the filename
        # The neon signs sit one level deeper (ILLUMINATED CABINETS/LED Neon Signs/<type>/<mount>)
        if len(parts) >= 2 and norm_sign(parts[0]) in ("ILLUMINATEDCABINETS", "BLADESIGNS", "NONILLUMINATEDCABINETS"):
            if len(parts) >= 3 and "NEON" in parts[1].upper():
                parts = parts[2:]
            else:
                parts = parts[1:]
        if not parts:
            errors.append("no sign-type folder: " + rel); continue

        sign = norm_sign(parts[0])
        rest = parts[1:]
        trim = thick = ""
        mount = ""
        for p in rest:
            if norm_trim(p) in ("WITHTRIM", "TRIMLESS"):
                trim = norm_trim(p)
            elif "thick" in p.lower():
                thick = norm_thick(p)
            else:
                mount = norm_mount(p)

        cands = index.get((sign, trim, thick, mount), [])
        if not cands and mount in ("flush", "stud"):       # flush/stud interchange (see docstring)
            other = "stud" if mount == "flush" else "flush"
            pool = index.get((sign, trim, thick, other), [])
            if pool and not index.get((sign, trim, thick, mount)):
                cands = pool
        if len(cands) != 1:
            errors.append("%-24s %s" % ("NO MATCH" if not cands else "AMBIGUOUS(%d)" % len(cands), rel))
            continue

        g, lf = cands[0]
        key = slug(g["signtype"], lf["trimcap"], lf["thickness"].replace("/", "-"), lf["mounting"])
        if key in assigned:
            errors.append("DUPLICATE KEY %s: %s vs %s" % (key, rel, assigned[key])); continue
        assigned[key] = rel
        matched[id(lf)] = (key, full, g, lf)

    # every leaf must have a diagram
    for g in groups:
        for lf in g["leaves"]:
            if id(lf) not in matched:
                errors.append("LEAF WITHOUT PNG: %s | %s | %s | %s" % (
                    g["signtype"], lf["trimcap"] or "-", lf["thickness"] or "-", lf["mounting"] or "-"))

    print("PNGs: %d   leaves: %d   matched: %d" % (len(pngs), sum(len(g["leaves"]) for g in groups), len(matched)))
    if errors:
        print("\n!! %d PROBLEM(S) — nothing written:" % len(errors))
        for e in errors:
            print("   " + e)
        sys.exit(1)

    os.makedirs(DEST, exist_ok=True)
    for key, full, g, lf in matched.values():
        shutil.copyfile(full, os.path.join(DEST, key + ".png"))
        src = src.replace(lf["raw"], lf["raw"].replace('sideview: ""', "sideview: " + json.dumps(key)), 1)
    open(DATA_JS, "w", encoding="utf-8", newline="\n").write(src)

    # the picker library: key + a human label built from the leaf's own answers
    lib = []
    for key, _full, g, lf in sorted(matched.values(), key=lambda x: x[0]):
        bits = [g["signtype"]] + [b for b in (lf["trimcap"], lf["thickness"], lf["mounting"]) if b]
        lib.append((key, " — ".join(bits).upper()))
    print("copied %d PNGs -> %s" % (len(matched), DEST))
    with open(os.path.join(HERE, "sideview_library.json"), "w", encoding="utf-8") as f:
        json.dump([{"key": k, "label": l} for k, l in lib], f, indent=2, ensure_ascii=False)
    print("wrote sideview_library.json (paste into sideviews.js)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else r"F:/Estimator Side Views-20260724T070657Z-1-001/Estimator Side Views")
