<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\PaymentLink;
use App\Models\Quote;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaymentLinkController extends Controller
{
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
