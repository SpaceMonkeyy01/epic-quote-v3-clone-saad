<?php

namespace App\Services;

use App\Models\Quote;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Creates the exact "unlisted product" the team makes by hand in Shopify, from a quote.
 * Dormant until SHOPIFY_STORE_DOMAIN + SHOPIFY_API_TOKEN are set (like CloudinaryService).
 *
 * Product mapping (locked with Sami):
 *   title      = "{Quote ID} - {Item Description}"
 *   vendor     = "EpicCraftings"
 *   type       = the sign type
 *   image      = the clean proposal preview (no price block)
 *   status     = active + published to Online Store (their "unlisted": reachable by link,
 *                not added to any collection/menu)
 *   inventory  = US location, qty 1 (tracked)
 *   variants   = Full Payment, and 50% Deposit — EXCEPT when the total is <= $500, where
 *                only Full Payment is offered. Balance is generated later as its own link.
 * We send the customer the product-page link.
 */
class ShopifyService
{
    public static function configured(): bool
    {
        return !empty(self::domain()) && !empty(config('services.shopify.token'));
    }

    /** Normalized store host, e.g. "my-store.myshopify.com" — tolerates a pasted URL/slash. */
    public static function domain(): ?string
    {
        $d = trim((string) config('services.shopify.domain'));
        if ($d === '') {
            return null;
        }
        $d = preg_replace('#^https?://#i', '', $d);   // drop protocol
        $d = explode('/', $d)[0];                      // drop any path
        return $d ?: null;
    }

    /** Customer-facing storefront host for product links: the configured custom domain
     *  (e.g. epiccraftings.com) if set, else the myshopify store domain. Using the custom
     *  domain avoids the slow .myshopify.com → custom-domain redirect (#10). */
    public static function storefrontHost(): ?string
    {
        $s = trim((string) config('services.shopify.storefront_domain'));
        if ($s !== '') {
            $s = preg_replace('#^https?://#i', '', $s);
            $s = explode('/', $s)[0];
            if ($s !== '') {
                return $s;
            }
        }
        return self::domain();
    }

    /** Full amount at or below this → full payment only (no 50% deposit option). */
    public const FULL_ONLY_MAX = 500.0;

    /**
     * Build the REST product payload (pure — no network, unit-testable).
     * $kind: 'quote' (Full + Deposit variants), or 'balance' (single Balance variant).
     */
    /**
     * @param string|array|null $images   one clean-image data URL, or an ARRAY of them (one per
     *                                     sign on a multi-page quote — all attach to the product).
     * @param string|null       $titleOverride  combined title for a multi-sign quote
     *                                     ("A & B FOR Company"); null → the single-sign default.
     */
    public static function buildProductPayload(Quote $quote, float $total, string|array|null $images, string $kind = 'full', ?string $titleOverride = null): array
    {
        $gd = $quote->generated_data ?: [];
        $itemDesc = $gd['custom_spec']['itemDesc'] ?? $quote->job_name ?: 'CUSTOM SIGNAGE';
        $signType = $gd['tpl_name'] ?? ($gd['custom_spec']['signType'] ?? '');

        $variants = self::variantsFor($total, $kind);
        // title: multi-sign quotes pass a combined title; single-sign uses the classic
        // "{ID} - {Title Case item} - {Payment part}" (#1, #4).
        $baseTitle = $titleOverride !== null && trim($titleOverride) !== ''
            ? self::titleCase(trim($titleOverride))
            : self::titleCase($itemDesc);
        $title = trim($quote->quote_id.' - '.$baseTitle.' - '.self::kindLabel($kind));

        // Category (#3): "LED Signs" if ANY sign is illuminated/LED, else "Business Signs". The
        // true Shopify standard-category column is a taxonomy field REST can't set — we put the
        // label in a tag (so it's visible/filterable) and set product_type per the team's rule.
        $category = self::signCategory($gd, $signType);

        $product = [
            'title'          => $title,
            // Show the sign SPECS beneath the "Pay now" CTA (#9), not a bare sign-type tag.
            'body_html'      => self::specsHtml($gd, $signType),
            'vendor'         => 'EpicCraftings',
            'product_type'   => 'Custom Business Signs',   // always, per the team's convention (#3)
            'status'         => 'active',                 // purchasable
            'published_scope' => 'web',                   // Online Store
            'tags'           => 'estimator,'.$quote->quote_id.','.$kind.','.$category,
            // random handle suffix → the URL is unguessable (privacy): someone can't just
            // increment the quote number to find another customer's link.
            'handle'         => \Illuminate\Support\Str::slug($title).'-'.\Illuminate\Support\Str::lower(\Illuminate\Support\Str::random(8)),
            'variants'       => $variants,
        ];

        // one image per sign — Shopify shows them all in the product gallery. Base64 "attachment"
        // (strip any data: URI prefix). Empty / malformed entries are skipped, not sent.
        $attachments = [];
        foreach ((array) $images as $img) {
            if (is_string($img) && $img !== '') {
                $attachments[] = ['attachment' => preg_replace('#^data:image/\w+;base64,#', '', $img)];
            }
        }
        if ($attachments) {
            $product['images'] = $attachments;
        }

        return ['product' => $product];
    }

    /** ONE variant matching the payment kind — so the product's price IS what the rep chose
     *  (full → full price, deposit/balance → half). No more multi-variant products defaulting
     *  to the cheapest option (#2). */
    public static function variantsFor(float $total, string $kind = 'full'): array
    {
        $price = fn ($n) => number_format(round($n, 2), 2, '.', '');
        $base = [
            // Track inventory and keep exactly ONE in stock (team convention): the link shows
            // "1 in stock" and is a one-time purchase. The quantity itself is set at the US
            // location AFTER create (see setInventoryOne) — REST no longer accepts it inline.
            'inventory_management' => 'shopify',
            'inventory_policy'     => 'deny',
            'requires_shipping'    => true,
            'taxable'              => true,
        ];
        $amount = $kind === 'full' ? $total : $total / 2;
        // No option1 → Shopify uses the default variant, so the storefront shows NO "Full Payment"
        // selector tag. The payment kind already lives in the product title.
        return [['price' => $price($amount)] + $base];
    }

    /**
     * Set the product's stock to 1 at the US warehouse (the store's primary location for now).
     * Called right after createProduct. Returns true on success. On ANY failure the caller must
     * untrack the variant so the link never becomes an unpayable "sold out" (0 tracked stock).
     */
    public static function setInventoryOne(string $inventoryItemId): bool
    {
        if (!self::configured() || $inventoryItemId === '') {
            return false;
        }
        $domain  = self::domain();
        $version = config('services.shopify.version', '2025-01');
        $headers = ['X-Shopify-Access-Token' => config('services.shopify.token'), 'Content-Type' => 'application/json'];
        try {
            // primary (US) location — the first active location Shopify returns
            $loc = Http::timeout(15)->withHeaders($headers)
                ->get("https://{$domain}/admin/api/{$version}/locations.json", ['limit' => 1]);
            $locationId = $loc->json('locations.0.id');
            if (!$locationId) {
                return false;
            }
            $set = Http::timeout(15)->withHeaders($headers)
                ->post("https://{$domain}/admin/api/{$version}/inventory_levels/set.json", [
                    'location_id'       => $locationId,
                    'inventory_item_id' => $inventoryItemId,
                    'available'         => 1,
                ]);
            return $set->successful();
        } catch (\Throwable) {
            return false;
        }
    }

    /** Flip a product to the "Unlisted" status (#1): sellable via its direct link but hidden from
     *  search / collections / channels. This status only exists in GraphQL (ProductStatus.UNLISTED)
     *  — REST's status enum is active/draft/archived — so we PATCH it right after the REST create.
     *  Best-effort: on failure the product stays Active (still payable), just listed. */
    public static function setUnlisted(string $productId): bool
    {
        if (!self::configured() || $productId === '') {
            return false;
        }
        $domain  = self::domain();
        $version = config('services.shopify.version', '2025-01');
        $gid = 'gid://shopify/Product/'.$productId;
        // inline the UNLISTED enum literal; only the id is a variable
        $query = 'mutation($id: ID!) { productUpdate(product: { id: $id, status: UNLISTED }) '
               .'{ product { id status } userErrors { field message } } }';
        try {
            $resp = Http::timeout(15)->withHeaders([
                'X-Shopify-Access-Token' => config('services.shopify.token'), 'Content-Type' => 'application/json',
            ])->post("https://{$domain}/admin/api/{$version}/graphql.json", ['query' => $query, 'variables' => ['id' => $gid]]);
            return $resp->successful()
                && empty($resp->json('data.productUpdate.userErrors'))
                && $resp->json('data.productUpdate.product.status') === 'UNLISTED';
        } catch (\Throwable) {
            return false;
        }
    }

    /** Turn tracking OFF for a variant (safety fallback: a product whose stock we couldn't set
     *  must stay payable, not read "sold out"). Best-effort. */
    public static function untrackVariant(string $variantId): void
    {
        if (!self::configured() || $variantId === '') {
            return;
        }
        $domain  = self::domain();
        $version = config('services.shopify.version', '2025-01');
        try {
            Http::timeout(15)->withHeaders([
                'X-Shopify-Access-Token' => config('services.shopify.token'), 'Content-Type' => 'application/json',
            ])->put("https://{$domain}/admin/api/{$version}/variants/{$variantId}.json", [
                'variant' => ['id' => $variantId, 'inventory_management' => null, 'inventory_policy' => 'continue'],
            ]);
        } catch (\Throwable) { /* best-effort */ }
    }

    /** Build the storefront product description: the sign specs shown under the CTA. On a multi-
     *  sign quote this concatenates EVERY sign's specs (A, B, C…), each under its own heading —
     *  not just the first sign (#10). Falls back to the sign type when a part has no spec text. */
    public static function specsHtml(array $gd, string $signType = ''): string
    {
        $partOf = function (array $p, string $fallbackType): string {
            $specs = trim((string) ($p['custom_spec']['specText'] ?? ($p['ai']['fullSpec'] ?? '')));
            if ($specs === '') {
                // fall back to the ACTUAL spec block shown on the proposal (HTML) → plain text
                $html = (string) ($p['proposal_state']['specBody'] ?? '');
                if ($html !== '') {
                    $specs = trim(html_entity_decode(strip_tags(preg_replace('/<br\s*\/?>/i', "\n", $html)), ENT_QUOTES | ENT_HTML5));
                }
            }
            return $specs !== '' ? nl2br(e($specs)) : e($fallbackType);
        };

        $parts = (isset($gd['parts']) && is_array($gd['parts']) && $gd['parts'] !== []) ? $gd['parts'] : null;
        if (!$parts) {
            return $partOf($gd, $signType);   // legacy single sign
        }
        if (count($parts) === 1) {
            return $partOf($parts[0], $parts[0]['tpl_name'] ?? $signType);
        }
        // multiple signs → one titled block per sign
        $blocks = [];
        foreach ($parts as $i => $p) {
            $letter = chr(65 + $i);                       // A, B, C…
            $name = trim((string) ($p['custom_spec']['itemDesc'] ?? $p['tpl_name'] ?? ('Sign '.$letter)));
            $blocks[] = '<h4>'.e($name !== '' ? $name : ('Sign '.$letter)).'</h4>'.$partOf($p, $p['tpl_name'] ?? '');
        }
        return implode('<hr>', $blocks);
    }

    /** "LED Signs" when any sign is illuminated / LED, else "Business Signs" (#3). Reads the sign
     *  type + spec text of every part. */
    public static function signCategory(array $gd, string $signType = ''): string
    {
        $parts = (isset($gd['parts']) && is_array($gd['parts']) && $gd['parts'] !== []) ? $gd['parts'] : [$gd];
        $haystack = $signType;
        foreach ($parts as $p) {
            $haystack .= ' '.($p['tpl_name'] ?? '').' '.($p['custom_spec']['specText'] ?? '').' '.($p['ai']['fullSpec'] ?? '');
        }
        return preg_match('/\b(LED|ILLUMINAT|NEON|LIT)\b/i', $haystack) ? 'LED Signs' : 'Business Signs';
    }

    /** Human label for a payment kind (goes in the title + variant). */
    public static function kindLabel(string $kind): string
    {
        return match ($kind) {
            'deposit' => '50% Deposit',
            'balance' => 'Remaining Balance (50%)',
            default   => 'Full Payment',
        };
    }

    /** Title Case: first letter of each word capitalized, not ALL CAPS (#4). */
    public static function titleCase(string $s): string
    {
        return \Illuminate\Support\Str::title(mb_strtolower(trim($s)));
    }

    /**
     * Create the product in Shopify. Returns ['ok'=>true, 'product_id','handle','url','variants']
     * on success, or ['ok'=>false, 'reason'=>..., 'status'=>?, 'message'=>?] on failure so the
     * caller can show WHY (bad token, missing scope, rejected payload, …).
     */
    public static function createProduct(array $payload): array
    {
        if (!self::configured()) {
            return ['ok' => false, 'reason' => 'not_configured'];
        }
        $domain  = self::domain();
        $version = config('services.shopify.version', '2025-01');

        try {
            $resp = Http::timeout(20)->withHeaders([
                'X-Shopify-Access-Token' => config('services.shopify.token'),
                'Content-Type'           => 'application/json',
            ])->post("https://{$domain}/admin/api/{$version}/products.json", $payload);
        } catch (\Throwable $e) {
            return ['ok' => false, 'reason' => 'network', 'message' => $e->getMessage()];
        }

        if (!$resp->successful()) {
            return ['ok' => false, 'reason' => 'shopify_error', 'status' => $resp->status(), 'message' => self::errorText($resp->status(), $resp->json() ?? $resp->body())];
        }
        $p = $resp->json('product');
        if (!$p) {
            return ['ok' => false, 'reason' => 'no_product'];
        }
        $variants = collect($p['variants'] ?? [])->map(fn ($v) => [
            'id'                => (string) $v['id'],
            'inventory_item_id' => (string) ($v['inventory_item_id'] ?? ''),
            'title'             => $v['title'] ?? $v['option1'] ?? '',
            'price'             => $v['price'] ?? '',
        ])->all();
        $variantId = (string) ($variants[0]['id'] ?? '');
        return [
            'ok'         => true,
            'product_id' => (string) $p['id'],
            'handle'     => $p['handle'] ?? '',
            // CART PERMALINK, not the product page. A cart permalink (/cart/{variant}:1) makes
            // Shopify EMPTY the current cart and add only THIS one item, then go to checkout — so
            // each link bills exactly its own amount. Product-page links did the opposite: the cart
            // is shared per customer session, so a customer who opened several deposit links piled
            // them all into one cart and got billed the SUM (the "$18k instead of $6k" bug). If a
            // variant id is somehow missing, fall back to the product page (payable, just not
            // cart-clearing) rather than emit a broken /cart/:1 link.
            'url'        => $variantId !== ''
                ? self::checkoutUrl(self::storefrontHost(), $variantId)
                : 'https://'.self::storefrontHost().'/products/'.($p['handle'] ?? ''),
            'variants'   => $variants,
        ];
    }

    /** Cart-permalink checkout URL for a single variant. SUPERSEDED by createDraftOrder(): on the
     *  live store, opening several cart links still ACCUMULATED into one cart (a customer got billed
     *  the SUM of every deposit link they opened). The cart is shared per session, so no cart-based
     *  URL is safe. Kept only for the fix-links migration to detect old links. */
    public static function checkoutUrl(?string $host, string $variantId): string
    {
        return 'https://'.$host.'/cart/'.$variantId.':1';
    }

    /** Create a Shopify DRAFT ORDER for a single variant and return its standalone checkout link
     *  (invoice_url). This is the ONLY safe payment link: an invoice checkout contains ONLY this
     *  draft order's line item — it uses NO cart, so two links can never combine (the accumulation
     *  bug that billed a customer the sum of every link they opened). When the invoice is paid,
     *  Shopify creates an order carrying the variant's product_id, so the orders/paid webhook still
     *  matches the payment link by product_id — paid-tracking is unchanged. */
    public static function createDraftOrder(string $variantId, ?string $email = null): array
    {
        if (!self::configured() || $variantId === '') {
            return ['ok' => false, 'reason' => 'not_configured'];
        }
        try {
            $domain  = self::domain();
            $version = config('services.shopify.version', '2025-01');
            $body = ['draft_order' => ['line_items' => [['variant_id' => (int) $variantId, 'quantity' => 1]]]];
            if ($email) {
                $body['draft_order']['email'] = $email;
            }
            $resp = Http::timeout(20)->withHeaders(['X-Shopify-Access-Token' => config('services.shopify.token')])
                ->post("https://{$domain}/admin/api/{$version}/draft_orders.json", $body);
            if (!$resp->successful()) {
                return ['ok' => false, 'reason' => 'api', 'message' => is_string($resp->json('errors')) ? $resp->json('errors') : $resp->body()];
            }
            $do = $resp->json('draft_order') ?: [];
            $invoice = $do['invoice_url'] ?? null;
            if (!$invoice) {
                return ['ok' => false, 'reason' => 'no_invoice_url'];
            }
            return ['ok' => true, 'id' => (string) ($do['id'] ?? ''), 'invoice_url' => (string) $invoice];
        } catch (\Throwable $e) {
            Log::warning('Shopify createDraftOrder: '.$e->getMessage());
            return ['ok' => false, 'reason' => 'exception', 'message' => $e->getMessage()];
        }
    }

    /** Fetch a product's first variant id by product id (for rebuilding an existing link's
     *  cart permalink when the variant id wasn't stored). Null on any failure. */
    public static function productVariantId(string $productId): ?string
    {
        if (!self::configured() || $productId === '') {
            return null;
        }
        try {
            $domain  = self::domain();
            $version = config('services.shopify.version', '2025-01');
            $resp = Http::timeout(15)->withHeaders(['X-Shopify-Access-Token' => config('services.shopify.token')])
                ->get("https://{$domain}/admin/api/{$version}/products/{$productId}.json", ['fields' => 'variants']);
            $id = $resp->successful() ? ($resp->json('product.variants.0.id') ?? null) : null;
            return $id ? (string) $id : null;
        } catch (\Throwable $e) {
            Log::warning("Shopify productVariantId {$productId}: ".$e->getMessage());
            return null;
        }
    }

    /** Lightweight connection check (GET shop.json) — used by /api/shopify/status. */
    /** Fetch a product's handle by id (for rebuilding an existing link's URL). Null on any failure. */
    public static function productHandle(string $productId): ?string
    {
        if (!self::configured()) {
            return null;
        }
        $domain  = self::domain();
        $version = config('services.shopify.version', '2025-01');
        try {
            $resp = Http::timeout(15)->withHeaders(['X-Shopify-Access-Token' => config('services.shopify.token')])
                ->get("https://{$domain}/admin/api/{$version}/products/{$productId}.json", ['fields' => 'handle']);
        } catch (\Throwable) {
            return null;
        }
        return $resp->successful() ? ($resp->json('product.handle') ?: null) : null;
    }

    public static function testConnection(): array
    {
        if (!self::configured()) {
            return ['ok' => false, 'reason' => 'not_configured'];
        }
        $domain  = self::domain();
        $version = config('services.shopify.version', '2025-01');
        try {
            $resp = Http::timeout(15)->withHeaders(['X-Shopify-Access-Token' => config('services.shopify.token')])
                ->get("https://{$domain}/admin/api/{$version}/shop.json");
        } catch (\Throwable $e) {
            return ['ok' => false, 'reason' => 'network', 'message' => $e->getMessage()];
        }
        if ($resp->successful()) {
            return ['ok' => true, 'shop' => $resp->json('shop.name')];
        }
        return ['ok' => false, 'status' => $resp->status(), 'message' => self::errorText($resp->status(), $resp->json() ?? $resp->body())];
    }

    /** Turn a Shopify error response into a short human message. */
    private static function errorText(int $status, mixed $body): string
    {
        $detail = '';
        if (is_array($body)) {
            $errors = $body['errors'] ?? $body;
            $detail = is_array($errors) ? implode('; ', array_map(fn ($v) => is_array($v) ? implode(', ', $v) : (string) $v, (array) $errors)) : (string) $errors;
        } elseif (is_string($body)) {
            $detail = mb_substr(strip_tags($body), 0, 200);
        }
        $hint = match ($status) {
            401 => 'invalid API token',
            403 => 'the token is missing a scope (needs write_products)',
            404 => 'store domain not found — check SHOPIFY_STORE_DOMAIN',
            422 => 'Shopify rejected the product data',
            default => '',
        };
        return trim("HTTP {$status}".($hint ? " ({$hint})" : '').($detail ? ": {$detail}" : ''));
    }
}
