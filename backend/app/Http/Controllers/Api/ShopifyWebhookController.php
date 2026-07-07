<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\PaymentLink;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Receives Shopify's orders/paid webhook and flips the matching payment link (and its quote)
// to Paid automatically. Public route (Shopify has no bearer token) but every call is
// verified against the shared webhook secret, so nobody else can spoof "this was paid".
class ShopifyWebhookController extends Controller
{
    public function ordersPaid(Request $request): JsonResponse
    {
        $secret = config('services.shopify.webhook_secret');
        if (empty($secret)) {
            return response()->json(['error' => 'webhooks not configured'], 503);
        }

        // verify HMAC over the RAW body (Shopify signs the exact bytes)
        $raw = $request->getContent();
        $expected = base64_encode(hash_hmac('sha256', $raw, $secret, true));
        $given = (string) $request->header('X-Shopify-Hmac-Sha256', '');
        if (!hash_equals($expected, $given)) {
            return response()->json(['error' => 'invalid signature'], 401);
        }

        $order = json_decode($raw, true) ?: [];
        $productIds = collect($order['line_items'] ?? [])
            ->pluck('product_id')->filter()->map(fn ($id) => (string) $id)->unique();

        $marked = 0;
        foreach ($productIds as $pid) {
            $links = PaymentLink::where('shopify_product_id', $pid)->where('status', 'unpaid')->get();
            foreach ($links as $link) {
                $link->status = 'paid';
                $link->paid_at = now();
                $link->save();
                $marked++;
                // reflect on the quote: an order has been placed
                if ($link->quote && !$link->quote->order_confirmed) {
                    $link->quote->order_confirmed = true;
                    $link->quote->order_placed_at = now();
                    $link->quote->save();
                }
                ActivityLog::record($link->created_by, 'payment_link_paid', ($link->quote?->quote_id ?? '?').": {$link->kind} link paid via Shopify");
            }
        }

        // Always 200 so Shopify doesn't retry a payload we've understood (even if 0 matched).
        return response()->json(['ok' => true, 'marked_paid' => $marked]);
    }
}
