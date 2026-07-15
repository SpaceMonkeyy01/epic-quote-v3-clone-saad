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

## Step 4 — beta DB = a copy of prod

**CONFIRM FIRST what prod actually uses** — the copy method depends on it:
- If prod backend is **SQLite on the Render disk** (the `render.yaml` default): copy the
  `/var/data/database.sqlite` file to the beta service's disk (Render Shell, or a one-off
  export/import command). Beta then runs the same SQLite file, isolated.
- If prod backend is an **external MySQL**: `mysqldump` prod → import into a **new** beta MySQL
  database, then point beta's `DB_*` at it. Never point beta at the live DB.

Either way the copy is **read-only against prod** (a dump/file-read), so it can't harm live data.
Re-run the copy whenever you want fresh beta data. After copying, reset beta admin creds
(the copy carries live users) via `SEED_ADMIN_PASSWORD` + a re-seed, or a password reset.

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
