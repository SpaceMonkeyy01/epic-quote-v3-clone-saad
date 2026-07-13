<?php

namespace App\Services;

use App\Models\Quote;
use Illuminate\Support\Facades\Http;

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

        $product = [
            'title'          => $title,
            // Show the sign SPECS beneath the "Pay now" CTA (#9), not a bare sign-type tag.
            'body_html'      => self::specsHtml($gd, $signType),
            'vendor'         => 'EpicCraftings',
            'product_type'   => $signType ?: 'Sign',
            'status'         => 'active',                 // purchasable
            'published_scope' => 'web',                   // Online Store
            'tags'           => 'estimator,'.$quote->quote_id.','.$kind,
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
            // Always payable — allow selling even at 0 stock, so the product never reads "sold
            // out" and a paid deposit doesn't block the balance.
            'inventory_policy'  => 'continue',
            'requires_shipping' => true,
            'taxable'           => true,
        ];
        $amount = $kind === 'full' ? $total : $total / 2;
        // No option1 → Shopify uses the default variant, so the storefront shows NO "Full Payment"
        // selector tag (#9). The payment kind already lives in the product title.
        return [['price' => $price($amount)] + $base];
    }

    /** Build the storefront product description (#9): the sign specs, shown under the CTA. */
    public static function specsHtml(array $gd, string $signType = ''): string
    {
        $specs = trim((string) ($gd['custom_spec']['specText'] ?? ($gd['ai']['fullSpec'] ?? '')));
        if ($specs === '') {
            return e($signType);   // fall back to the sign type when there's no spec text yet
        }
        // Preserve line breaks; escape everything (no HTML injection from user-entered specs).
        return nl2br(e($specs));
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
            'id'    => (string) $v['id'],
            'title' => $v['title'] ?? $v['option1'] ?? '',
            'price' => $v['price'] ?? '',
        ])->all();
        return [
            'ok'         => true,
            'product_id' => (string) $p['id'],
            'handle'     => $p['handle'] ?? '',
            // PRODUCT PAGE: the customer lands on the sign's preview (image + specs) and pays from
            // there — NOT a cart permalink (/cart/…:1 forwarded straight to checkout, skipping the
            // preview). Each link is its own single-variant product, so nothing accumulates.
            'url'        => 'https://'.self::storefrontHost().'/products/'.($p['handle'] ?? ''),
            'variants'   => $variants,
        ];
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
