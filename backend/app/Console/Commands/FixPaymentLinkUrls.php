<?php

namespace App\Console\Commands;

use App\Models\PaymentLink;
use App\Services\ShopifyService;
use Illuminate\Console\Command;

/**
 * One-time fix: rewrite existing payment-link URLs from product pages to cart permalinks
 * (/cart/{variant}:1). Product-page links let every link a customer opened accumulate into one
 * cart, billing them for the whole queue at once. Idempotent — already-fixed rows are skipped.
 *
 *   php artisan payments:fix-links
 */
class FixPaymentLinkUrls extends Command
{
    protected $signature = 'payments:fix-links';

    protected $description = 'Rewrite payment-link URLs to single-item cart permalinks';

    public function handle(): int
    {
        $fixed = 0;
        $skipped = 0;
        foreach (PaymentLink::whereNotNull('shopify_variant_id')->get() as $link) {
            if (str_contains((string) $link->url, '/cart/')) {
                $skipped++;
                continue;
            }
            $host = parse_url((string) $link->url, PHP_URL_HOST) ?: ShopifyService::domain();
            $link->update(['url' => "https://{$host}/cart/{$link->shopify_variant_id}:1"]);
            $fixed++;
        }
        $this->info("fixed: {$fixed}, already-permalinks: {$skipped}");
        return self::SUCCESS;
    }
}
