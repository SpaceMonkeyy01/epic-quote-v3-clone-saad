<?php

namespace App\Console\Commands;

use App\Models\PaymentLink;
use App\Services\ShopifyService;
use Illuminate\Console\Command;

/**
 * Regenerate existing UNPAID payment-link URLs as Shopify DRAFT-ORDER invoice links (standalone
 * checkouts). The old links were cart/product URLs that piled into one shared cart — a customer who
 * opened several deposit links was billed the SUM ("$39,470 instead of one item"). A draft-order
 * invoice contains only its own line item, so accumulation is impossible.
 *
 * Only touches UNPAID links (a paid link is done; a void link stays void). Idempotent: a link that
 * already points at an invoice is skipped. --dry-run reports without writing.
 *
 *   php artisan payments:fix-links --dry-run
 *   php artisan payments:fix-links
 */
class FixPaymentLinkUrls extends Command
{
    protected $signature = 'payments:fix-links {--dry-run}';

    protected $description = 'Regenerate unpaid payment-link URLs as draft-order invoices (no shared cart)';

    public function handle(): int
    {
        if (!ShopifyService::configured()) {
            $this->error('Shopify is not configured — cannot create draft orders.');
            return self::FAILURE;
        }
        $dry = (bool) $this->option('dry-run');
        $fixed = 0;
        $skipped = 0;
        $failed = 0;
        foreach (PaymentLink::where('status', 'unpaid')->whereNotNull('shopify_product_id')->get() as $link) {
            if (str_contains((string) $link->url, '/invoices/')) {
                $skipped++;
                continue;
            }
            $variantId = (string) ($link->shopify_variant_id ?? '')
                ?: (string) (ShopifyService::productVariantId((string) $link->shopify_product_id) ?? '');
            if ($variantId === '') {
                $this->warn("{$link->id}: no variant id — skipped");
                $failed++;
                continue;
            }
            if ($dry) {
                $this->line("[dry] {$link->id}: {$link->url} → (new draft-order invoice)");
                $fixed++;
                continue;
            }
            $draft = ShopifyService::createDraftOrder($variantId, is_string($link->email) ? $link->email : null);
            if (!($draft['ok'] ?? false)) {
                $this->warn("{$link->id}: draft order failed — ".($draft['message'] ?? $draft['reason'] ?? 'unknown'));
                $failed++;
                continue;
            }
            $link->update(['url' => $draft['invoice_url']]);
            $this->line("{$link->id}: → {$draft['invoice_url']}");
            $fixed++;
        }
        $verb = $dry ? 'would regenerate' : 'regenerated';
        $this->info("{$verb}: {$fixed}, already-invoice: {$skipped}, could-not-resolve: {$failed}");
        return self::SUCCESS;
    }
}
