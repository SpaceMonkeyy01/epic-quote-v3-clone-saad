# Shopify payment links — go-live setup

Everything is built and dormant. To turn it on you do two things: create a Shopify custom
app (5 min, self-serve — no developer needed if you have store-owner access) and paste the
values into Render. Nothing here goes into the code or a chat message.

## 1. Create the custom app in Shopify (get the token)

In your Shopify admin:

1. **Settings → Apps and sales channels → Develop apps → Create an app** → name it `Epic Estimator`.
2. **Configure Admin API scopes** → tick:
   - `write_products`, `read_products`  (create the product + image)
   - `read_orders`  (see when an order is paid)
3. **Save** → **Install app**.
4. **API credentials** tab → **reveal the Admin API access token** → copy it. *(Starts with `shpat_…`.)*
5. Note your store address: `your-store.myshopify.com`.

## 2. Register the "paid" webhook (auto-marks links paid)

In Shopify admin → **Settings → Notifications → Webhooks** (or via the app):

- **Create webhook** → Event: **Order payment**, Format: **JSON**, URL:
  `https://<your-api-host>/api/shopify/webhook/orders-paid`
  (the API host is your Render API service, e.g. `https://epic-quote-v3-api.onrender.com`)
- Shopify shows a **signing secret** on the webhooks page — copy it.

## 3. Paste the values into Render (never into code)

Render → the **API** service → **Environment** → add:

| Key | Value |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` |
| `SHOPIFY_API_TOKEN` | the `shpat_…` token from step 1 |
| `SHOPIFY_API_VERSION` | `2025-01` (leave as-is unless Shopify tells you otherwise) |
| `SHOPIFY_WEBHOOK_SECRET` | the signing secret from step 2 |
| `SHOPIFY_LOCATION_ID` | *(optional)* your US warehouse location id |

Save → the API redeploys → payment links are live. **That's it.**

## 4. Decide who can create links

Users page → tick the **💳 Links** box for each person allowed to generate links.
Admins can always create them.

## What happens when it's on

- On a quote's proposal, whoever has permission sees **Full payment / 50% Deposit / Balance**
  (deposit & balance only when the total is over $500 — $500-or-less is full-payment only).
- Clicking one creates the exact product your team makes by hand (title `EC##### - <item>`,
  vendor Epic Craftings, sign type, the **clean** preview image without the price block,
  US warehouse qty 1, published to the Online Store) and gives you the **product-page link**.
- Every link is recorded under **Payment Links** — searchable by title / company / email /
  phone, with the image, amount, type and paid status.
- When the customer pays, Shopify's webhook flips the link (and the quote) to **Paid**
  automatically. You can also mark paid / void by hand any time.

## Privacy

The link is a **secret link**: unguessable and only ever shown to you (in the app) and the
customer (by email). It is not password-gated — same model as a "anyone with the link" doc —
which is what you chose (no customer logins). Only users with the 💳 permission can create
links, and the ledger is scoped so people only see links for quotes they're allowed to see.
