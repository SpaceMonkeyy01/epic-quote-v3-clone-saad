<?php

namespace App\Http\Controllers\Api;

use App\Constants\AppConstants;
use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Order;
use App\Models\Quote;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class DashboardController extends Controller
{
    // GET /api/dashboard — monthly stats + status cards (#38,#39)
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $now = Carbon::now();
        $monthStart = $now->copy()->startOfMonth();
        $nextMonth  = $now->copy()->startOfMonth()->addMonth();

        $base = fn () => Quote::query()->visibleTo($user);

        $monthQuotes = $base()
            ->whereBetween('created_at', [$monthStart, $nextMonth])
            ->get();
        $allQuotes = $base()->get();

        // status counts seeded with all 10 statuses (#39 clickable cards)
        $statusCounts = array_fill_keys(AppConstants::STATUS_OPTIONS, 0);
        foreach ($allQuotes as $q) {
            if (array_key_exists($q->status, $statusCounts)) {
                $statusCounts[$q->status]++;
            }
        }

        $totalQuotesMonth = $monthQuotes->count();
        $totalAmountMonth = (float) $monthQuotes->sum('price');

        // Conversion = quotes that reached "Done" (won) ÷ quotes created this month. The orders table
        // is unused, so "Done" is the real, meaningful signal for converted/won.
        $doneMonth = $monthQuotes->where('status', 'Done')->count();
        $conversion = $totalQuotesMonth ? ($doneMonth / $totalQuotesMonth * 100) : 0;
        $totalSalesValue = (float) $monthQuotes->where('status', 'Done')->sum('price');

        // Quotes-per-month trend (last 6 months) for the sparkline, plus % change vs last month.
        $trend = [];
        for ($i = 5; $i >= 0; $i--) {
            $mStart = $now->copy()->startOfMonth()->subMonths($i);
            $mEnd = $mStart->copy()->addMonth();
            $trend[] = [
                'label' => $mStart->format('M'),
                'count' => $allQuotes->filter(fn ($q) => $q->created_at && $q->created_at >= $mStart && $q->created_at < $mEnd)->count(),
            ];
        }
        $lastMonthStart = $monthStart->copy()->subMonth();
        $lastMonthCount = $allQuotes->filter(fn ($q) => $q->created_at && $q->created_at >= $lastMonthStart && $q->created_at < $monthStart)->count();
        $quotesDelta = $lastMonthCount ? (int) round(($totalQuotesMonth - $lastMonthCount) / $lastMonthCount * 100) : null;

        $openQuotes   = $allQuotes->where('status', '!=', 'Done');
        $pendingCount = $openQuotes->count();
        $pipelineValue = (float) $openQuotes->sum('price');
        $avgQuoteValue = $pendingCount ? round($pipelineValue / $pendingCount) : 0;

        // The "needs attention" queue — open quotes waiting on a rep action, most overdue first.
        $attentionStatuses = [
            'Artwork Needed', 'Quote Approval Needed', 'Need Payment Link Sent', 'Need To Share With Customer',
            'Awaiting Customer Response', 'Awaiting Rod Response', 'Awaiting Sir Sami Response',
        ];
        $needsAttention = $allQuotes
            ->whereIn('status', $attentionStatuses)
            ->map(fn ($q) => [
                'quote_id'     => $q->quote_id,
                'company_name' => $q->company_name,
                'job_name'     => $q->job_name,
                'price'        => (float) $q->price,
                'status'       => $q->status,
                'days_waiting' => $q->updated_at ? (int) $q->updated_at->diffInDays($now) : 0,
            ])
            ->sortByDesc('days_waiting')
            ->take(8)
            ->values();

        return response()->json([
            'month_label'     => $now->format('F Y'),
            'cards'           => $statusCounts,
            'pipeline_value'  => $pipelineValue,
            'avg_quote_value' => $avgQuoteValue,
            'needs_attention' => $needsAttention,
            'quotes_trend'    => $trend,
            'quotes_delta'    => $quotesDelta,
            'totals'      => [
                'total_quotes_month' => $totalQuotesMonth,
                'total_amount_month' => $totalAmountMonth,
            ],
            'reports' => [
                'total_quotes_created'   => $totalQuotesMonth,
                'total_orders_confirmed' => $doneMonth,
                'conversion_rate'        => round($conversion, 1),
                'total_sales_value'      => $totalSalesValue,
                'pending_count'          => $pendingCount,
            ],
        ]);
    }

    // GET /api/reports/sales-reps — admin only (#107)
    public function salesReps(Request $request): JsonResponse
    {
        if (!$request->user()->isAdmin()) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $now = Carbon::now();
        $weekStart  = $now->copy()->subDays(7);
        $monthStart = $now->copy()->startOfMonth();
        $nextMonth  = $now->copy()->startOfMonth()->addMonth();

        $repStats = function (string $rep, Carbon $start, Carbon $end): array {
            $quotes = Quote::where('sales_rep', $rep)
                ->whereBetween('created_at', [$start, $end])
                ->get();
            $received  = $quotes->count();
            $converted = $quotes->where('status', 'Done')->count();   // "Done" = won/converted
            $rate = $received ? ($converted / $received * 100) : 0;
            return [
                'total_quotes_received' => $received,
                'quotes_converted'      => $converted,
                'conversion_rate'       => round($rate, 1),
            ];
        };

        $out = [];
        foreach (AppConstants::SALES_REPS as $rep) {
            $out[] = [
                'name'    => $rep,
                'weekly'  => $repStats($rep, $weekStart, $now),
                'monthly' => $repStats($rep, $monthStart, $nextMonth),
            ];
        }

        return response()->json($out);
    }

    // GET /api/activity — admin only, last 150 (#108)
    public function activity(Request $request): JsonResponse
    {
        if (!$request->user()->isAdmin()) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        $logs = ActivityLog::with('user')
            ->latest('created_at')
            ->limit(150)
            ->get()
            ->map(fn ($l) => [
                'user'    => $l->user?->full_name ?? 'Unknown',
                'action'  => $l->action,
                'details' => $l->details,
                'at'      => $l->created_at?->toIso8601String(),
            ]);

        return response()->json($logs);
    }
}
