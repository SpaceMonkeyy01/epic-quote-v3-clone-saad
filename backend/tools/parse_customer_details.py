# Parse a raw customer-history CSV (Name | Customer Details | Email) into a normalized
# companies/contacts CSV ready for `php artisan companies:import`.
#
#   python tools/parse_customer_details.py <input.csv> <output.csv>
#
# Handles: labeled lines (Company Name:/Customer Name:/Phone:/Cell:/Office:/Address:/Email:/…),
# "Company X" (no colon), unprefixed company first-lines, address continuation lines,
# single-line "phone / address" rows, contact-block tails (Cell/Office/T:/F:), person
# "<email>" lines, multi-email cells, corrupted-encoding phones, generic email domains.
import csv, re, sys
from collections import OrderedDict

if len(sys.argv) != 3:
    sys.exit("usage: python parse_customer_details.py <input.csv> <output.csv>")
SRC, OUT = sys.argv[1], sys.argv[2]

COMPANY_KEYS = {"company name", "company", "business", "business name", "store"}
NAME_KEYS    = {"customer name", "name", "client name", "contact name", "attn", "for", "customer"}
PHONE_KEYS   = {"phone", "phone number", "cell", "office", "direct", "ph", "tel", "telephone", "mobile", "contact"}
ADDR_KEYS    = {"address", "shipping address", "ship to", "location", "addr"}
EMAIL_KEYS   = {"email", "e-mail", "mail"}

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(\+?\d[\d\s().\-]{6,}\d)")
GENERIC_DOMAINS = {"gmail", "yahoo", "hotmail", "outlook", "aol", "icloud", "comcast", "live", "msn", "me", "att", "verizon", "sbcglobal", "protonmail", "mail"}

def norm_ws(s):
    return re.sub(r"\s+", " ", s.replace(" ", " ")).strip()

def looks_like_phone(s):
    # ignore qualifier words like "(Business)", "(Cell)", "ext 12" when judging
    core = re.sub(r"\((?:business|cell|office|home|work|fax|direct|mobile|main)\)", "", s, flags=re.I)
    core = re.sub(r"\b(?:ext|x)\.?\s*\d+\b", "", core, flags=re.I)
    d = re.sub(r"\D", "", core)
    return 7 <= len(d) <= 15 and len(re.sub(r"[\d\s().+\-/#.]", "", core)) <= 2

def looks_like_address(s):
    if re.search(r"\d{5}(-\d{4})?$", s.strip()):  # ends in ZIP
        return True
    if re.search(r"\b(st|street|ave|avenue|rd|road|dr|drive|blvd|hwy|highway|ln|lane|suite|ste|unit|way|ct|court|pkwy|circle|cir)\b\.?", s, re.I) and re.search(r"\d", s):
        return True
    if re.search(r",\s*[A-Z]{2}\s+\d{5}", s):  # City, ST 12345
        return True
    return False

def company_from_email(email):
    dom = email.split("@")[-1].split(".")[0].lower()
    if dom in GENERIC_DOMAINS or len(dom) < 3:
        return ""
    pretty = re.sub(r"[-_]+", " ", dom).strip()
    # "signarama newmarket" -> "Signarama Newmarket"
    return " ".join(w.capitalize() for w in pretty.split())

STREET_WORDS = r"(?:st|street|ave|avenue|rd|road|dr|drive|blvd|hwy|highway|ln|lane|suite|ste|unit|way|ct|court|pkwy|place|pl|circle|cir)"

def clean_company(raw):
    """Sanitize a company candidate. Returns (company, extra_name, extra_email, extra_phone)."""
    s = norm_ws(raw).strip(" ,;|-–—·")
    name = email = phone = ""
    # "Jane Doe <jane@x.com>" — a person line, not a company
    m = re.match(r"^([^<>@]{2,60})<\s*(" + EMAIL_RE.pattern + r")\s*>?$", s)
    if m and EMAIL_RE.fullmatch(m.group(2)):
        return "", norm_ws(m.group(1)).strip(" -,"), m.group(2).lower(), ""
    # leading "E:" / "Email" then an address
    m = re.match(r"^(?:e|email)\s*:?\s+(\S+@\S+)$", s, re.I)
    if m:
        return "", "", m.group(1).strip(",;").lower(), ""
    # pull out any embedded email(s), keep the text before the first one
    em = EMAIL_RE.search(s)
    if em:
        email = em.group(0).lower()
        s = s[:em.start()]
    # cut at inline contact-block markers FIRST ("… Cell(704)…", "T: 718-…", "Office #: …")
    # (no \b after ':'/'#' — they're non-word chars, so use explicit patterns)
    s = re.split(r"(?i)\bcell\b|\bmain office\b|\b[tfwom]\s*:|office\s*#", s)[0]
    # pull a trailing phone ("FASTSIGNS of Beaverton (503) 526-0216")
    pm = re.search(r"\(?\+?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\s*$", s)
    if pm:
        phone = pm.group(0).strip()
        s = s[:pm.start()]
    # cut a glued/comma'd address tail: ", 1700 University Pl" or "Wonders1700 University"
    am = re.search(r",?\s*\d{2,6}\s+[A-Za-z0-9 .'-]+\b" + STREET_WORDS + r"\b.*$", s, re.I)
    if am and am.start() > 2:
        s = s[:am.start()]
    # ", City, ST" style tail after the name
    s = re.split(r",\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Z]{2}\b", s)[0]
    s = norm_ws(s).strip(" ,;|-–—·<:")
    # reject: phone-ish, corrupted-encoding phones (559?597?4467), emails, note sentences, address-y
    if (not s or len(s) < 3 or looks_like_phone(s)
            or re.search(r"\d\?\d", s) or "@" in s
            or re.match(r"(?:this|please|note)\b", s, re.I)
            or re.search(r",\s*\d{5}\b", s)):
        return "", name, email, phone
    return s, name, email, phone

def parse_details(text):
    company = name = phone = email = ""
    addr_parts = []
    last_field = None
    for raw in text.splitlines():
        ln = norm_ws(raw).strip('"').strip()
        if not ln:
            last_field = None
            continue
        m = re.match(r"^([A-Za-z][A-Za-z /.-]{1,24}?)\s*[:：]\s*(.*)$", ln)
        if m:
            key, val = m.group(1).strip().lower(), m.group(2).strip()
            if key in COMPANY_KEYS:
                company = company or val; last_field = "company"
            elif key in NAME_KEYS:
                # "Contact:" can hold a phone — route by content
                if key == "contact" and looks_like_phone(val):
                    phone = phone or val; last_field = "phone"
                else:
                    name = name or val; last_field = "name"
            elif key in PHONE_KEYS:
                if looks_like_phone(val) or not val:
                    phone = phone or val
                elif EMAIL_RE.search(val):
                    email = email or EMAIL_RE.search(val).group(0)
                else:
                    name = name or val   # "Contact: John Smith"
                last_field = "phone"
            elif key in ADDR_KEYS:
                if val: addr_parts.append(val)
                last_field = "address"
            elif key in EMAIL_KEYS:
                em = EMAIL_RE.search(val)
                if em: email = email or em.group(0)
                last_field = None
            else:
                last_field = None   # unknown label — ignore its value
            continue
        # ---- unlabeled line ----
        if ln.lower().startswith("company ") and len(ln) > 8:
            company = company or ln[8:].strip(); last_field = "company"; continue
        em = EMAIL_RE.fullmatch(ln)
        if em:
            email = email or ln; last_field = None; continue
        if last_field == "address" or looks_like_address(ln):
            addr_parts.append(ln); last_field = "address"; continue
        if looks_like_phone(ln):
            phone = phone or ln; last_field = "phone"; continue
        # single-line "phone / address"
        if "/" in ln:
            left, right = [p.strip() for p in ln.split("/", 1)]
            if looks_like_phone(left):
                phone = phone or left
                if right: addr_parts.append(right)
                last_field = "address"; continue
        # bare text line: company if none yet, else person name if none, else address tail
        if not company and not looks_like_address(ln):
            company = ln; last_field = "company"
        elif not name:
            name = ln; last_field = "name"
        else:
            addr_parts.append(ln); last_field = "address"
    return company, name, phone, email, ", ".join(addr_parts)

def main():
    rows = list(csv.reader(open(SRC, encoding="utf-8-sig", newline="")))[1:]
    parsed, skipped = [], 0
    for r in rows:
        col1 = norm_ws(r[0]) if len(r) > 0 else ""
        col2 = r[1] if len(r) > 1 else ""
        col3 = r[2] if len(r) > 2 else ""
        company, name, phone, d_email, address = parse_details(col2) if col2.strip() else ("", "", "", "", "")
        # email: first valid from col3, else the one found inside col2
        emails = EMAIL_RE.findall(col3)
        email = (emails[0] if emails else d_email).lower()
        # sanitize the company candidate; it may really be a person/email/phone line
        if company:
            company, xname, xemail, xphone = clean_company(company)
            name = name or xname
            email = email or xemail
            phone = phone or xphone
        # a "name" that is really a phone line ("Phone (253) 922-2146") → route to phone
        if name:
            stripped = re.sub(r"(?i)^phone\s*", "", name)
            if looks_like_phone(stripped):
                phone = phone or stripped
                name = ""
        # contact name: labeled name, else the Name column (it's the person)
        if not name:
            name = col1
        # company fallback: branded email domain
        if not company and email:
            company = company_from_email(email)
        company, name, phone, address = map(norm_ws, (company, name, phone, address))
        if not company and not email and not name:
            skipped += 1
            continue
        if not company:      # schema requires a company; count these
            skipped += 1
            continue
        parsed.append((company, name, phone, email, address))

    # ---- dedup ----
    def key(s): return re.sub(r"[^a-z0-9]", "", s.lower())
    companies = OrderedDict()   # ckey -> {name, address}
    reps = OrderedDict()        # (ckey, rkey) -> row
    for company, name, phone, email, address in parsed:
        ck = key(company)
        c = companies.setdefault(ck, {"company": company, "address": ""})
        if address and len(address) > len(c["address"]):   # keep the fullest address
            c["address"] = address
        rk = key(email) or key(name)
        if not rk:
            continue
        cur = reps.get((ck, rk))
        if cur is None:
            reps[(ck, rk)] = {"company": company, "contact_name": name, "phone": phone, "email": email, "address": address}
        else:   # backfill blanks on the existing rep
            for f, v in (("contact_name", name), ("phone", phone), ("email", email)):
                if v and not cur[f]:
                    cur[f] = v

    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["company", "contact name", "phone", "email", "address"])
        for (ck, rk), rep in reps.items():
            w.writerow([companies[ck]["company"], rep["contact_name"], rep["phone"], rep["email"], companies[ck]["address"] or rep["address"]])

    print(f"input rows: {len(rows)} | parsed: {len(parsed)} | skipped(no company resolvable): {skipped}")
    print(f"unique companies: {len(companies)} | unique contacts: {len(reps)}")
    print("sample:")
    for i, ((ck, rk), rep) in enumerate(reps.items()):
        if i >= 8: break
        print("  ", rep["company"], "|", rep["contact_name"], "|", rep["phone"], "|", rep["email"])

if __name__ == "__main__":
    main()
