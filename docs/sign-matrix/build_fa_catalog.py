"""
FA catalog generator  —  'QUOTE ESTIMATOR - FA.csv'  ->  frontend/src/generator/faCatalogData.js
================================================================================================
The boss's FA sheet is the SINGLE SOURCE OF TRUTH for every sign type, its options, and the
verbatim SPECIFICATIONS block printed on the proposal. This script is the ONLY way that file
is produced — never hand-edit faCatalogData.js, re-run this instead:

    python docs/sign-matrix/build_fa_catalog.py "F:/QUOTE ESTIMATOR - FA.csv"

SHEET SHAPE (columns, 0-indexed)
  2 family   3 sign type   4 trim cap   5 proposal template   6 thickness
  7 mounting 8 specs       9 side view  10 package includes

Blank cells mean "same as the row above" (merged cells in the original spreadsheet), so every
column is forward-filled. The fill is SCOPED: starting a new sign type clears trim cap /
thickness / mounting, and a new trim cap clears thickness / mounting — otherwise a later
group would silently inherit an earlier group's options (that is exactly how "TRIM LESS"
leaked onto sign types that have no trim cap at all).

QUOTING ARTIFACT (why the cleanup below is not cosmetic): several spec cells in the export
were quoted twice, so after CSV decoding they still carry a wrapping quote pair and every
inner inch-mark is doubled — `[HEIGHT]"" X [WIDTH]""`. Those artifacts were printing on real
proposals. `clean_block` undoes exactly that double-encoding and nothing else.
"""
import csv, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "frontend", "src", "generator", "faCatalogData.js"))
DEFAULT_CSV = r"F:/QUOTE ESTIMATOR - FA.csv"

C_FAMILY, C_SIGN, C_TRIM, C_TPL, C_THICK, C_MOUNT, C_SPEC, C_SIDE, C_PKG = 2, 3, 4, 5, 6, 7, 8, 9, 10

NA = {"", "n/a", "na", "none", "-"}
is_na = lambda v: str(v or "").strip().lower() in NA


def clean_block(s):
    """Undo the sheet's double-quoting artifact on a spec cell (see module docstring)."""
    s = (s or "").replace("\r\n", "\n").strip()
    if s.startswith('"') and s.endswith('"') and len(s) > 1:
        s = s[1:-1]
    elif s.startswith('"'):
        s = s[1:]
    # Only collapse doubled quotes that are inch-marks/stray escapes, never a real `""` pair
    # used as an empty value — the sheet has none of the latter.
    s = s.replace('""', '"')
    return s.strip()


def parse_line(raw):
    """One spec line -> a render instruction. Token type decides what the wizard asks for."""
    v = raw.rstrip()
    if "[HEIGHT]" in v or "[WIDTH]" in v:
        return {"t": "dims", "v": v}
    if "[DEPTH]" in v:
        return {"t": "depth", "v": v}
    if "[APPLICATION]" in v:
        return {"t": "application", "v": v}
    if "[ASK REP]" in v:
        # "  • FACE COLOR: [ASK REP]"  ->  label 'FACE COLOR'
        m = re.match(r"^\s*(?:[•*\-•⁠ ]+\s*)?(.+?)\s*:\s*\[ASK REP\]\s*$", v)
        label = (m.group(1) if m else "VALUE").strip().strip("⁠  ")
        return {"t": "field", "label": label, "v": v}
    return {"t": "text", "v": v}


def parse_spec(cell):
    block = clean_block(cell)
    if not block or block.lower() == "custom":
        return []
    return [parse_line(ln) for ln in block.split("\n")]


def load(csv_path):
    with open(csv_path, encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))

    groups, order = [], []
    by_key = {}
    cur = {C_FAMILY: "", C_SIGN: "", C_TRIM: "", C_TPL: "", C_THICK: "", C_MOUNT: "", C_SIDE: "", C_PKG: ""}

    for row in rows[2:]:                                  # rows 0-1 are the banner + header
        if len(row) <= C_PKG or not any(c.strip() for c in row):
            continue
        cell = lambda i: (row[i] if i < len(row) else "").strip()

        # ── scoped forward-fill: a new value at any level clears everything below it ──
        if cell(C_FAMILY):
            cur[C_FAMILY] = cell(C_FAMILY)
        if cell(C_SIGN):
            cur[C_SIGN] = cell(C_SIGN)
            cur[C_TRIM] = cur[C_THICK] = cur[C_MOUNT] = ""
        if cell(C_TRIM):
            cur[C_TRIM] = cell(C_TRIM)
            cur[C_THICK] = cur[C_MOUNT] = ""
        if cell(C_THICK):
            cur[C_THICK] = cell(C_THICK)
            cur[C_MOUNT] = ""
        for c in (C_TPL, C_MOUNT, C_SIDE, C_PKG):
            if cell(c):
                cur[c] = cell(c)

        if not cur[C_SIGN]:
            continue
        spec = parse_spec(cell(C_SPEC))
        if not spec:                                      # Pylon/Monument/Custom rows carry no block
            continue

        key = (cur[C_FAMILY], cur[C_SIGN])
        if key not in by_key:
            g = {"family": cur[C_FAMILY], "signtype": cur[C_SIGN], "leaves": []}
            by_key[key] = g
            groups.append(g)
            if cur[C_FAMILY] not in order:
                order.append(cur[C_FAMILY])

        by_key[key]["leaves"].append({
            "trimcap":  "" if is_na(cur[C_TRIM]) else cur[C_TRIM],
            "thickness": "" if is_na(cur[C_THICK]) else cur[C_THICK],
            "mounting": "" if is_na(cur[C_MOUNT]) else cur[C_MOUNT],
            "package":  "" if is_na(cur[C_PKG]) else cur[C_PKG],
            "sideview": "",                               # filled by map_sideviews.py
            "lines": spec,
        })

    for g in groups:
        g["hasTrimCap"] = len({l["trimcap"] for l in g["leaves"] if l["trimcap"]}) > 1
        g["hasThickness"] = len({l["thickness"] for l in g["leaves"] if l["thickness"]}) > 1
    return order, groups


def emit(order, groups, csv_path):
    j = lambda o: json.dumps(o, ensure_ascii=False)
    L = [
        "/* AUTO-GENERATED — do not hand-edit. Regenerate with:",
        "     python docs/sign-matrix/build_fa_catalog.py \"%s\"" % csv_path,
        "   Every spec line below is VERBATIM from the FA sheet; only the bracketed",
        "   placeholders ([HEIGHT] [WIDTH] [DEPTH] [APPLICATION] [ASK REP]) are substituted",
        "   at render time. Side-view keys come from docs/sign-matrix/map_sideviews.py. */",
        "",
        "export const FA_FAMILY_ORDER = " + j(order),
        "",
        "// Each group = one Sign Type card in the wizard. `leaves` = every concrete",
        "// (trim cap × thickness × mounting) combination the sheet defines for it.",
        "export const FA_SIGN_GROUPS = [",
    ]
    for g in groups:
        L.append("  {")
        L.append("    family: %s, signtype: %s," % (j(g["family"]), j(g["signtype"])))
        L.append("    hasTrimCap: %s, hasThickness: %s," % (str(g["hasTrimCap"]).lower(), str(g["hasThickness"]).lower()))
        L.append("    leaves: [")
        for lf in g["leaves"]:
            L.append("      { trimcap: %s, thickness: %s, mounting: %s, package: %s, sideview: %s, lines: %s }," % (
                j(lf["trimcap"]), j(lf["thickness"]), j(lf["mounting"]),
                j(lf["package"]), j(lf["sideview"]), j(lf["lines"])))
        L.append("    ],")
        L.append("  },")
    L.append("]")
    L.append("")
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L))


if __name__ == "__main__":
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    order, groups = load(csv_path)
    emit(order, groups, csv_path)
    print("families: %d   sign types: %d   leaves: %d" % (
        len(order), len(groups), sum(len(g["leaves"]) for g in groups)))
    for g in groups:
        flags = "".join(["T" if g["hasTrimCap"] else "-", "K" if g["hasThickness"] else "-"])
        print("  [%s] %-46s %-38s %2d leaves" % (flags, g["family"][:44], g["signtype"][:36], len(g["leaves"])))
    print("wrote " + OUT)
