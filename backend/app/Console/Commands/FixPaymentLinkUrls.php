<?php

namespace App\Console\Commands;

use App\Models\PaymentLink;
use App\Services\ShopifyService;
use Illuminate\Console\Command;

/**
 * Rebuild payment-link URLs to PRODUCT-PAGE links (/products/{handle}) — the customer lands on the
 * sign's preview and pays from there. Fetches each product's handle from Shopify by its stored id.
 * Idempotent: a link already pointing at /products/ is skipped; anything else (a stray cart or
 * invoice URL left over from an earlier approach) is rewritten. Best-effort; unreachable rows are
 * left as-is. --dry-run reports without writing.
 *
 *   php artisan payments:fix-links --dry-run
 *   php artisan payments:fix-links
 */
class FixPaymentLinkUrls extends Command
{
    protected $signature = 'payments:fix-links {--dry-run}';

    protected $description = 'Rebuild payment-link URLs to product-page links';

    public function handle(): int
    {
        if (!ShopifyService::configured()) {
            $this->error('Shopify is not configured — cannot look up product handles.');
            return self::FAILURE;
        }
        $dry = (bool) $this->option('dry-run');
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
            $url = "https://{$host}/products/{$handle}";
            $this->line(($dry ? '[dry] ' : '')."{$link->id}: {$link->url} → {$url}");
            if (!$dry) {
                $link->update(['url' => $url]);
            }
            $fixed++;
        }
        $verb = $dry ? 'would fix' : 'fixed';
        $this->info("{$verb}: {$fixed}, already-product-links: {$skipped}, could-not-resolve: {$failed}");
        return self::SUCCESS;
    }
}
