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
            'inventory_management' => 'shopify',   // track stock (US location, qty 1)
            'inventory_policy'     => 'deny',
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
     * Create the product in Shopify and return
     * ['product_id','handle','url','variants'=>[['id','title','price'],...]] — or null if
     * not configured / the call fails (caller surfaces a clear error).
     */
    public static function createProduct(array $payload): ?array
    {
        if (!self::configured()) {
            return null;
        }
        $domain  = self::domain();
        $version = config('services.shopify.version', '2025-01');

        $resp = Http::withHeaders([
            'X-Shopify-Access-Token' => config('services.shopify.token'),
            'Content-Type'           => 'application/json',
        ])->post("https://{$domain}/admin/api/{$version}/products.json", $payload);

        if (!$resp->successful()) {
            return null;
        }
        $p = $resp->json('product');
        if (!$p) {
            return null;
        }
        return [
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
}
