<?php

namespace App\Console\Commands;

use App\Models\PaymentLink;
use App\Services\ShopifyService;
use Illuminate\Console\Command;

/**
 * Rewrite existing payment-link URLs to CART PERMALINKS (/cart/{variant}:1). Product-page links
 * accumulate: the Shopify cart is shared per customer session, so a customer who opened several
 * deposit links piled them into one cart and got billed the SUM ("$18k instead of $6k"). A cart
 * permalink empties the cart and adds only that one item, so each link bills exactly its own amount.
 *
 * Uses the variant id stored on the link; falls back to fetching it from Shopify by product id.
 * Idempotent (a link already pointing at /cart/ is skipped). --dry-run reports without writing.
 *
 *   php artisan payments:fix-links --dry-run
 *   php artisan payments:fix-links
 */
class FixPaymentLinkUrls extends Command
{
    protected $signature = 'payments:fix-links {--dry-run}';

    protected $description = 'Rewrite payment-link URLs to cart permalinks so links never accumulate in one cart';

    public function handle(): int
    {
        if (!ShopifyService::configured()) {
            $this->error('Shopify is not configured — cannot resolve variant ids.');
            return self::FAILURE;
        }
        $dry = (bool) $this->option('dry-run');
        $host = ShopifyService::storefrontHost();
        $fixed = 0;
        $skipped = 0;
        $failed = 0;
        foreach (PaymentLink::whereNotNull('shopify_product_id')->get() as $link) {
            if (str_contains((string) $link->url, '/cart/')) {
                $skipped++;
                continue;
            }
            $variantId = (string) ($link->shopify_variant_id ?? '')
                ?: (string) (ShopifyService::productVariantId((string) $link->shopify_product_id) ?? '');
            if ($variantId === '') {
                $failed++;
                continue;
            }
            $url = ShopifyService::checkoutUrl($host, $variantId);
            $this->line(($dry ? '[dry] ' : '')."{$link->id}: {$link->url} → {$url}");
            if (!$dry) {
                $link->update(['url' => $url, 'shopify_variant_id' => $variantId]);
            }
            $fixed++;
        }
        $verb = $dry ? 'would fix' : 'fixed';
        $this->info("{$verb}: {$fixed}, already-cart-links: {$skipped}, could-not-resolve: {$failed}");
        return self::SUCCESS;
    }
}
