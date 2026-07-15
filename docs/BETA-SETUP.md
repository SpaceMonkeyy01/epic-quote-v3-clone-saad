# BETA / STAGING ENVIRONMENT — setup runbook

Goal: an **isolated** place to test incremental changes before they hit the live estimator —
so a test click can never mutate live customer data or fire a real Shopify payment link.

Shape (confirmed 2026-07-15):
- **Beta backend** — a *second* Render web service, deployed from the `staging` branch, with its
  OWN env: sandbox Shopify + its own DB. This is the piece a "share the backend" plan can't give you.
- **Beta frontend** — a *second* Render static site from `staging`, `VITE_API_URL` → beta API.
- **Beta DB** — a one-time copy of prod (real quotes to test against), separate from prod.
- **Promote** — merge `staging → main`; the live Render frontend/backend are never touched by beta.

```
  LIVE (untouched)                     BETA (isolated)
  epic-quote-v3-web-saad   ─┐          epic-quote-v3-web-beta   ─┐
        │ VITE_API_URL      │                │ VITE_API_URL      │
        ▼                   │                ▼                   │
  epic-quote-v3-api-saad    │          epic-quote-v3-api-beta    │
        │                   │  deploy        │                  │  deploy
        ▼                   │  from main     ▼                  │  from staging
   LIVE DB + LIVE Shopify  ─┘          BETA DB + SANDBOX Shopify ┘
```

---

## The one guardrail that matters

**Beta must never hold the live Shopify token.** If beta's `SHOPIFY_API_TOKEN` is the live one,
"testing" a payment link creates a REAL product + REAL payable link on the live store.

Two safe choices for beta's Shopify env:
- **Payments OFF (default, safest):** leave `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_API_TOKEN` **unset**
  in beta. The code treats unset Shopify as "feature off" — the payment buttons simply no-op.
  Pick this unless you are specifically testing the payment flow.
- **Sandbox payments:** create a Shopify **development store** (free, dev stores can't take real
  money), and put THAT store's domain + Admin API token in beta. Never the production store's.

---

## Step 1 — the `staging` branch

Beta services deploy from `staging`; live stays on `main`. Keep `staging` a strict
descendant of `main` so promotion is a clean fast-forward merge.

```
git checkout -b staging
git push origin staging        # + `git push second staging` if Render watches the `second` remote
```

Workflow per task: branch work → merge into `staging` → beta auto-deploys → test →
when green, merge `staging → main` → live deploys.

## Step 2 — beta backend service (Render dashboard)

New → Web Service → same repo → **Branch: `staging`**, Docker, `./backend/Dockerfile`,
context `./backend`, health check `/api/health`. Name it `epic-quote-v3-api-beta`.

Env vars — **same as live EXCEPT these**, which MUST differ:

| Key | Live | Beta |
|---|---|---|
| `APP_KEY` | live key | **new** key (`php artisan key:generate --show`) |
| `APP_ENV` | `production` | `staging` |
| `APP_URL` | live API url | the beta API's own https url |
| `DB_*` | live DB | **beta DB** (Step 4) |
| `SHOPIFY_STORE_DOMAIN` | live store | **unset** (or dev store) — see guardrail |
| `SHOPIFY_API_TOKEN` | live `shpat_…` | **unset** (or dev-store token) — see guardrail |
| `CLOUDINARY_URL` | live | a separate Cloudinary (or reuse read-only) — beta uploads shouldn't mix with live assets |
| `SEED_ADMIN_PASSWORD` | live | a beta-only password |

Everything else (`GROQ_*`, `APP_DEBUG=false`, versions) can match live. Copy them in the
dashboard — secrets are entered by you there, never committed.

> CORS: no change needed. `config/cors.php` already allows `https://epic-quote-v3-*.onrender.com`.
> If beta gets a custom domain instead, add it to the `CORS_ALLOWED_ORIGINS` env var (comma-separated).

## Step 3 — beta frontend service (Render dashboard)

New → Static Site → same repo → **Branch: `staging`**, root `frontend`,
build `npm ci && npm run build`, publish `dist`. Name it `epic-quote-v3-web-beta`.
Reuse the SPA rewrite + security headers from the live static site (see `render.yaml`).

Env: `VITE_API_URL` = the **beta** API url from Step 2. (This is the only wiring that points
the beta UI at the beta backend.)

## Step 4 — beta DB = a copy of prod (SQLite on disk)

Prod runs **SQLite at `/var/data/database.sqlite`** on the Render disk. It's a single file, so the
"copy" is just: move that file onto beta's disk. Render disks aren't shared between services and
there's no file-download button, so the file travels through a one-time transit. Render **Shell**
(available on the Starter plan, under each service's dashboard) is how you run these.

The copy only **reads** the prod file, so it can't harm live data. Do it whenever you want fresh
beta data.

### 4a. Export from PROD (prod service → Shell)

```
gzip -c /var/data/database.sqlite > /tmp/db.sqlite.gz
```

Then upload `/tmp/db.sqlite.gz` to a transit beta can reach. **This file contains real customer
PII** — prefer a private transit and delete it right after:
- **Private (preferred):** a short-lived pre-signed S3/GCS URL, or a private Cloudinary *raw*
  upload — whatever you already control. Get back a download URL.
- **Quick but public:** `curl --upload-file /tmp/db.sqlite.gz https://transfer.sh/db.sqlite.gz`
  → returns a URL. The URL is unguessable and expires, but the object is public while it lives —
  acceptable only for a one-time small DB, and **delete it immediately after import.**

### 4b. Import into BETA (beta service → Shell)

```
curl -o /var/data/database.sqlite.gz "<the-transit-url>"
gunzip -f /var/data/database.sqlite.gz         # → /var/data/database.sqlite
php artisan migrate --force                     # bring schema current (idempotent)
php artisan db:seed --force                      # resets beta admin from SEED_ADMIN_PASSWORD
```

Then **Manual Deploy → Restart** the beta service so it opens the new file. Delete the transit
object now.

> The copied DB carries live users (with live password hashes) and live `payment_links` rows. With
> Shopify off in beta (Step 2) those rows are inert. `db:seed` re-asserts the beta admin so you can
> log in with `SEED_ADMIN_PASSWORD`; other users keep their prod hashes (unusable in beta, which is
> fine).

> **Optional upgrade:** if you'll re-copy often, I can add an idempotent `db:export-sqlite` /
> `db:import-sqlite` artisan pair (private transit, admin reset, row-count report, `--dry-run`) so
> this becomes two commands instead of Shell steps. Say the word.

## Step 5 — verify isolation before trusting it

1. Beta UI loads and talks to the **beta** API (check the network tab origin).
2. Create/delete a throwaway quote in beta → confirm it does **not** appear in live.
3. If Shopify is on in beta, confirm links are created on the **dev** store, not the live store.
4. Only then start doing real test work on beta.

---

## Promotion (beta → live)

```
git checkout main
git merge --ff-only staging     # staging must be ahead of main only
git push origin main            # + `git push second main` — live deploys
```

Keep `staging` rebased on `main` after each promotion so the next round is clean.
