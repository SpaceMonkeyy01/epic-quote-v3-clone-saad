<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\PaymentLink;
use App\Models\Quote;
use App\Services\CloudinaryService;
use App\Services\ShopifyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class PaymentLinkController extends Controller
{
    // POST /api/quotes/{quote}/payment-link — create a Shopify product + link and log it.
    // Body: kind (full|deposit|balance), image (clean preview PNG data URL), email, contact.
    public function store(Request $request, Quote $quote): JsonResponse
    {
        $user = $request->user();
        if (!$user->canCreatePaymentLinks()) {
            return response()->json(['error' => 'You do not have permission to create payment links.'], 403);
        }
        if (!$quote->isVisibleTo($user)) {
            return response()->json(['error' => 'forbidden'], 403);
        }
        // reuse the approval lock (a locked, unapproved quote must not go out the door)
        if ($quote->approval_locked && !$quote->price_approved) {
            return response()->json(['error' => 'This quote is locked — the price must be approved before a payment link can be created.'], 422);
        }

        // Effective price: the quote column, or (for older quotes not yet re-saved) the price
        // held in generated_data (custom_spec.price / answers.price).
        $gdAll = $quote->generated_data ?: [];
        $total = (float) $quote->price;
        if ($total <= 0) {
            $fallback = $gdAll['custom_spec']['price'] ?? ($gdAll['answers']['price'] ?? null);
            if (is_numeric($fallback)) {
                $total = (float) $fallback;
            }
        }
        if ($total <= 0) {
            return response()->json(['error' => 'Set a price on the quote before creating a payment link.'], 422);
        }

        $kind = $request->input('kind', 'full');
        if (!in_array($kind, ['full', 'deposit', 'balance'], true)) {
            return response()->json(['error' => 'invalid kind'], 400);
        }
        // ≤ $500 → full payment only (Sami's rule)
        if ($total <= ShopifyService::FULL_ONLY_MAX && $kind !== 'full') {
            return response()->json(['error' => 'Quotes of $500 or less are full-payment only.'], 422);
        }

        // the clean product image (base64 data URL) → permanent storage
        $imageBase64 = $request->input('image');   // "data:image/png;base64,…"
        $imageRef = $imageBase64 ? $this->storeImage($imageBase64, $quote->quote_id.'-'.$kind) : null;

        // build + create the Shopify product (dormant until configured)
        $group = $kind === 'balance' ? 'balance' : 'quote';
        $payload = ShopifyService::buildProductPayload($quote, $total, $imageBase64, $group);
        $result = ShopifyService::createProduct($payload);

        if ($result === null) {
            return response()->json([
                'error' => ShopifyService::configured()
                    ? 'Shopify rejected the request — please try again or check the store settings.'
                    : 'Shopify isn’t connected yet. An admin needs to add the store token before links can be generated.',
                'not_configured' => !ShopifyService::configured(),
            ], ShopifyService::configured() ? 502 : 503);
        }

        // pick the variant that matches this kind
        $wanted = $kind === 'deposit' ? '50% Deposit' : ($kind === 'balance' ? 'Balance (50%)' : 'Full Payment');
        $variant = collect($result['variants'])->firstWhere('title', $wanted) ?? ($result['variants'][0] ?? null);
        $amount = $kind === 'full' ? $total : round($total / 2, 2);

        $gd = $quote->generated_data ?: [];
        $link = PaymentLink::create([
            'quote_id'           => $quote->id,
            'title'              => $payload['product']['title'],
            'image'              => $imageRef,
            'specs'              => $gd['custom_spec']['specText'] ?? ($gd['ai']['fullSpec'] ?? ''),
            'company_name'       => $quote->company_name,
            'side_view'          => implode(',', (array) ($gd['side_views'] ?? [])),
            'contact'            => $request->input('contact', $quote->contact),
            'email'              => $request->input('email', $quote->email),
            'amount'             => $amount,
            'quote_total'        => $total,
            'kind'               => $kind,
            'shopify_product_id' => $result['product_id'],
            'shopify_variant_id' => $variant['id'] ?? null,
            'url'                => $result['url'],
            'status'             => 'unpaid',
            'created_by'         => $user->id,
        ]);

        ActivityLog::record($user->id, 'payment_link_created', "{$quote->quote_id}: {$kind} link ({$amount})");

        return response()->json($link->toApi(), 201);
    }

    // Decode a base64 data URL → permanent storage (Cloudinary if configured, else public disk).
    private function storeImage(string $dataUrl, string $name): ?string
    {
        if (!preg_match('#^data:image/(\w+);base64,(.+)$#s', $dataUrl, $m)) {
            return null;
        }
        $bytes = base64_decode($m[2], true);
        if ($bytes === false) {
            return null;
        }
        $filename = preg_replace('/[^A-Za-z0-9._-]/', '_', $name).'.'.($m[1] === 'jpeg' ? 'jpg' : $m[1]);

        if (CloudinaryService::configured()) {
            $tmp = tempnam(sys_get_temp_dir(), 'pl_').'.png';
            file_put_contents($tmp, $bytes);
            $url = CloudinaryService::upload($tmp, 'epic-quote/payment-links', 'image');
            @unlink($tmp);
            return $url ?: null;
        }
        Storage::disk('public')->put("payment-links/{$filename}", $bytes);
        return $filename;
    }

    // GET /api/payment-links — the private ledger, searchable, scoped to what the user can see.
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        // Only show links for quotes this user is allowed to see (owner / assignee / repless / admin).
        $visibleQuoteIds = Quote::query()->visibleTo($user)->pluck('id');

        $q = PaymentLink::with(['quote', 'creator'])
            ->whereIn('quote_id', $visibleQuoteIds)
            ->latest('created_at');

        if ($status = trim((string) $request->query('status', ''))) {
            $q->where('status', $status);
        }
        if ($kind = trim((string) $request->query('kind', ''))) {
            $q->where('kind', $kind);
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $like = '%'.$search.'%';
            $q->where(function ($w) use ($like) {
                $w->where('title', 'like', $like)
                  ->orWhere('company_name', 'like', $like)
                  ->orWhere('email', 'like', $like)
                  ->orWhere('contact', 'like', $like);
            });
        }

        return response()->json($q->get()->map->toApi());
    }

    // PUT /api/payment-links/{paymentLink}/status — mark paid / unpaid / void (manual control;
    // the Shopify webhook flips it automatically once wired, but the team can always override).
    public function updateStatus(Request $request, PaymentLink $paymentLink): JsonResponse
    {
        $quote = $paymentLink->quote;
        if (!$quote || !$quote->isVisibleTo($request->user())) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $status = $request->input('status');
        if (!in_array($status, ['unpaid', 'paid', 'void'], true)) {
            return response()->json(['error' => 'invalid status'], 400);
        }

        $paymentLink->status = $status;
        $paymentLink->paid_at = $status === 'paid' ? now() : null;
        $paymentLink->save();

        ActivityLog::record($request->user()->id, 'payment_link_status', "{$quote->quote_id}: {$paymentLink->kind} link marked {$status}");

        return response()->json($paymentLink->toApi());
    }
}
