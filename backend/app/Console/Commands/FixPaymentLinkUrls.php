<?php

namespace App\Console\Commands;

use App\Models\PaymentLink;
use App\Services\ShopifyService;
use Illuminate\Console\Command;

/**
 * Rebuild existing payment-link URLs to PRODUCT-PAGE links (/products/{handle}), so the customer
 * lands on the sign's preview instead of being forwarded straight to checkout. Fetches each
 * product's handle from Shopify by its stored product id. Idempotent — a link that already points
 * at /products/ is skipped. Needs Shopify configured (best-effort; unreachable rows are left as-is).
 *
 *   php artisan payments:fix-links
 */
class FixPaymentLinkUrls extends Command
{
    protected $signature = 'payments:fix-links';

    protected $description = 'Rebuild payment-link URLs to product-page links';

    public function handle(): int
    {
        if (!ShopifyService::configured()) {
            $this->error('Shopify is not configured — cannot look up product handles.');
            return self::FAILURE;
        }
        $host = ShopifyService::storefrontHost();
        $fixed = 0;
        $skipped = 0;
        $failed = 0;
        foreach (PaymentLink::whereNotNull('shopify_product_id')->get() as $link) {
            if (str_contains((string) $link->url, '/products/')) {
                $skipped++;
                continue;
            }
            $handle = ShopifyService::productHandle((string) $link->shopify_product_id);
            if (!$handle) {
                $failed++;
                continue;
            }
            $link->update(['url' => "https://{$host}/products/{$handle}"]);
            $fixed++;
        }
        $this->info("fixed: {$fixed}, already-product-links: {$skipped}, could-not-resolve: {$failed}");
        return self::SUCCESS;
    }
}
