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

    /** Full amount at or below this → full payment only (no 50% deposit option). */
    public const FULL_ONLY_MAX = 500.0;

    /**
     * Build the REST product payload (pure — no network, unit-testable).
     * $kind: 'quote' (Full + Deposit variants), or 'balance' (single Balance variant).
     */
    public static function buildProductPayload(Quote $quote, float $total, ?string $imageBase64, string $kind = 'quote'): array
    {
        $gd = $quote->generated_data ?: [];
        $itemDesc = $gd['custom_spec']['itemDesc'] ?? $quote->job_name ?: 'CUSTOM SIGNAGE';
        $signType = $gd['tpl_name'] ?? ($gd['custom_spec']['signType'] ?? '');

        $variants = self::variantsFor($total, $kind);

        $product = [
            'title'          => trim($quote->quote_id.' - '.$itemDesc),
            'body_html'      => e($signType),
            'vendor'         => 'EpicCraftings',
            'product_type'   => $signType ?: 'Sign',
            'status'         => 'active',                 // purchasable
            'published_scope' => 'web',                   // Online Store
            'tags'           => 'estimator,'.$quote->quote_id,
            // random handle suffix → the URL is unguessable (privacy): someone can't just
            // increment the quote number to find another customer's link.
            'handle'         => \Illuminate\Support\Str::slug($quote->quote_id.' '.$itemDesc).'-'.\Illuminate\Support\Str::lower(\Illuminate\Support\Str::random(8)),
            'variants'       => $variants,
        ];

        if ($imageBase64) {
            // Shopify accepts a base64 "attachment" (strip any data: URI prefix)
            $product['images'] = [[
                'attachment' => preg_replace('#^data:image/\w+;base64,#', '', $imageBase64),
            ]];
        }

        return ['product' => $product];
    }

    /** Variant list for a total + kind. Deposit is half; ≤ $500 → full only. */
    public static function variantsFor(float $total, string $kind = 'quote'): array
    {
        $price = fn ($n) => number_format(round($n, 2), 2, '.', '');
        $base = [
            // A payment link must ALWAYS be payable — so allow selling even at 0 stock
            // ('continue'), otherwise the product reads "sold out" and the customer can't pay,
            // and a paid deposit would block the balance. (Untracked stock, effectively.)
            'inventory_policy'     => 'continue',
            'requires_shipping'    => true,
            'taxable'              => true,
        ];

        if ($kind === 'balance') {
            return [['option1' => 'Balance (50%)', 'price' => $price($total / 2)] + $base];
        }

        // quote: Full always; Deposit only when total > $500
        $variants = [['option1' => 'Full Payment', 'price' => $price($total)] + $base];
        if ($total > self::FULL_ONLY_MAX) {
            $variants[] = ['option1' => '50% Deposit', 'price' => $price($total / 2)] + $base;
        }
        return $variants;
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
        return [
            'ok'         => true,
            'product_id' => (string) $p['id'],
            'handle'     => $p['handle'] ?? '',
            'url'        => 'https://'.$domain.'/products/'.($p['handle'] ?? ''),
            'variants'   => collect($p['variants'] ?? [])->map(fn ($v) => [
                'id'    => (string) $v['id'],
                'title' => $v['title'] ?? $v['option1'] ?? '',
                'price' => $v['price'] ?? '',
            ])->all(),
        ];
    }

    /** Lightweight connection check (GET shop.json) — used by /api/shopify/status. */
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
