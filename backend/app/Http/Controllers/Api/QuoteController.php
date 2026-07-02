<?php

namespace App\Http\Controllers\Api;

use App\Constants\AppConstants;
use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Company;
use App\Models\Quote;
use App\Models\Representative;
use App\Models\Setting;
use App\Models\StatusHistory;
use App\Services\CloudinaryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class QuoteController extends Controller
{
    // GET /api/quotes — list with search + status filter, scoped to non-admins (#40,#41,#52)
    public function index(Request $request): JsonResponse
    {
        $q = Quote::query()->visibleTo($request->user());

        $status = $request->query('status');
        if ($status === '__pending__') {
            $q->where('status', '!=', 'Done');     // V1 "Pending" filter
        } elseif ($status) {
            $q->where('status', $status);
        }

        if ($search = $request->query('search')) {
            $like = '%'.$search.'%';
            $q->where(function ($w) use ($like) {
                $w->where('quote_id', 'like', $like)
                  ->orWhere('company_name', 'like', $like)
                  ->orWhere('job_name', 'like', $like)
                  ->orWhere('client_name', 'like', $like);
            });
        }

        $quotes = $q->latest('created_at')->get()->map->toApi();

        return response()->json($quotes);
    }

    // POST /api/quotes — Add Quote (#33-37)
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        $companyName = trim((string) $request->input('company_name', ''));
        $clientName  = trim((string) $request->input('client_name', ''));
        $contact     = trim((string) $request->input('contact', ''));
        $address     = trim((string) $request->input('address', ''));
        $jobName     = trim((string) $request->input('job_name', ''));
        $special     = trim((string) $request->input('special_requirements', ''));
        $salesRep    = trim((string) $request->input('sales_rep', ''));
        $quoteSource = (string) $request->input('quote_source', '');
        $orderId     = trim((string) $request->input('order_id', ''));
        $qid         = strtoupper(trim((string) $request->input('quote_id', '')));  // IDs are case-insensitive → normalize

        // Non-admins can only create quotes assigned to themselves
        if (!$user->isAdmin()) {
            $salesRep = $user->full_name;
        }

        // --- validation ---
        // Company is optional: AI mode is PDF-first and fills it from the drawing (workstream B).
        // Sales rep can be any typed name (not limited to the preset list), just required + sane length.
        if ($salesRep === '' || mb_strlen($salesRep) > 80) {
            return response()->json(['error' => 'Sales Representative is required (max 80 chars)'], 400);
        }
        // Quote ID is auto-generated server-side (unique EC number). Quote source + order ID
        // were dropped as a UX/feature decision. Only validate a Quote ID if one was supplied.
        if ($qid !== '') {
            // Custom IDs must look like real quote IDs (EC + digits) — junk IDs ("dfh") pollute
            // dashboards, reports and search, and can't be told apart from real quotes.
            if (!preg_match('/^EC\d{4,12}$/', $qid)) {
                return response()->json(['error' => 'Quote ID must be EC followed by numbers (e.g. EC100123) — or leave it blank to auto-generate'], 400);
            }
            // case-insensitive uniqueness — "ec100012" must collide with "EC100012"
            if (Quote::whereRaw('UPPER(quote_id) = ?', [$qid])->exists()) {
                return response()->json(['error' => "Quote ID \"{$qid}\" already exists"], 400);
            }
        }

        // customer PDF/image, max 25 MB (#37)
        $file = $request->file('customer_pdf');
        if ($file) {
            $request->validate([
                'customer_pdf' => 'file|mimes:pdf,jpg,jpeg,png,gif,webp,avif,svg|max:25600',
            ]);
        }

        $quote = DB::transaction(function () use (
            $companyName, $clientName, $contact, $address, $jobName, $special,
            $salesRep, $quoteSource, $orderId, $qid, $file, $user
        ) {
            // auto-create company (case-insensitive dedup) — only when a name is supplied.
            // AI mode is PDF-first (no typed company yet); B fills it later via update.
            $company = null;
            if ($companyName !== '') {
                $company = Company::whereRaw('LOWER(name) = ?', [strtolower($companyName)])->first();
                if (!$company) {
                    $company = Company::create([
                        'name' => $companyName, 'address' => $address, 'email' => '', 'phone' => '',
                    ]);
                } elseif ($address && !$company->address) {
                    $company->update(['address' => $address]);
                }

                // auto-create representative for a new client (#35)
                if ($clientName !== '') {
                    $exists = Representative::where('company_id', $company->id)
                        ->whereRaw('LOWER(name) = ?', [strtolower($clientName)])->exists();
                    if (!$exists) {
                        Representative::create([
                            'company_id' => $company->id, 'name' => $clientName, 'email' => $contact,
                        ]);
                    }
                }
            }

            [$num, $autoId] = Setting::nextQuoteId();
            $qid = $qid !== '' ? $qid : $autoId;   // auto-generate a unique EC id when none supplied

            // store customer file as {qid}_{original} — permanent (Cloudinary) like every upload
            $pdfFilename = null;
            if ($file) {
                $stored = $this->storeUploadPermanently($file, 'pdfs', $qid.'_'.$this->safeFilename($file));
                $pdfFilename = $stored[0] ?? null;
            }

            return Quote::create([
                'quote_id'             => $qid,
                'quote_num'            => $num,
                'order_id'             => '',
                'company_id'           => $company?->id,
                'company_name'         => $company?->name ?? '',
                'client_name'          => $clientName,
                'contact'              => $contact,
                'address'              => $address ?: ($company?->address ?? ''),
                'job_name'             => $jobName,
                'special_requirements' => $special,
                'customer_pdf'         => $pdfFilename,
                'sales_rep'            => $salesRep,
                'quote_source'         => $quoteSource,
                'status'               => 'To Do',
                'tags'                 => [],
                'price'                => 0,   // no price yet — the UI shows "—" until the rep sets a real one (never a fake $1,200)
                'created_by'           => $user->id,
            ]);
        });

        ActivityLog::record($user->id, 'quote_created', "{$quote->quote_id} for {$companyName}");

        return response()->json($quote->toApi(), 201);
    }

    // GET /api/quotes/{quote}
    public function show(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        return response()->json($quote->toApi(includeGenerated: true));
    }

    // PUT /api/quotes/{quote} — inline edit of all fields (#47)
    public function update(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $user = $request->user();
        $data = $request->all();
        $changes = [];

        if (array_key_exists('quote_id', $data)) {
            $newQid = trim((string) $data['quote_id']);
            if ($newQid !== $quote->quote_id) {
                if ($newQid === '') {
                    return response()->json(['error' => 'Quote ID is required'], 400);
                }
                if (!preg_match('/^[A-Za-z0-9_-]+$/', $newQid)) {
                    return response()->json(['error' => 'Quote ID may only contain letters, numbers, hyphens and underscores'], 400);
                }
                if (strlen($newQid) > 20) {
                    return response()->json(['error' => 'Quote ID must be 20 characters or fewer'], 400);
                }
                if (Quote::where('quote_id', $newQid)->exists()) {
                    return response()->json(['error' => "Quote ID \"{$newQid}\" already exists"], 400);
                }
                $changes[] = "Quote ID: {$quote->quote_id} -> {$newQid}";
                $quote->quote_id = $newQid;
            }
        }

        if (array_key_exists('sales_rep', $data)) {
            // V1: only admins can reassign the sales rep (#7)
            if (!$user->isAdmin()) {
                return response()->json(['error' => 'Only admins can change the Sales Representative'], 403);
            }
            $newRep = trim((string) $data['sales_rep']);
            if ($newRep === '' || mb_strlen($newRep) > 80) {
                return response()->json(['error' => 'Sales Representative is required (max 80 chars)'], 400);
            }
            if ($newRep !== $quote->sales_rep) {
                $changes[] = "Sales Rep: {$quote->sales_rep} -> {$newRep}";
                $quote->sales_rep = $newRep;
            }
        }

        if (array_key_exists('quote_source', $data)) {
            if (!in_array($data['quote_source'], AppConstants::QUOTE_SOURCES, true)) {
                return response()->json(['error' => 'Invalid Quote Source'], 400);
            }
            if ($data['quote_source'] !== $quote->quote_source) {
                $changes[] = 'Quote Source';
            }
            $quote->quote_source = $data['quote_source'];
        }

        foreach (['client_name', 'contact', 'address', 'job_name', 'special_requirements', 'company_name', 'order_id'] as $field) {
            if (array_key_exists($field, $data)) {
                // ConvertEmptyStringsToNull turns '' into null; these columns are NOT NULL
                // default '' (V1 stored '', never null), so coalesce back to ''.
                $value = $data[$field] ?? '';
                if ((string) ($quote->{$field} ?? '') !== (string) $value) {
                    $changes[] = ucwords(str_replace('_', ' ', $field));
                }
                $quote->{$field} = $value;
            }
        }

        if (array_key_exists('price', $data) && is_numeric($data['price'])) {
            $newPrice = (float) $data['price'];
            if ($newPrice < 0 || $newPrice > 10000000) {
                return response()->json(['error' => 'Price must be between $0 and $10,000,000.'], 422);
            }
            if ($newPrice !== (float) ($quote->price ?? 0)) {
                $changes[] = 'Final Price';
            }
            $quote->price = $newPrice;
        }

        if (array_key_exists('tags', $data) && is_array($data['tags'])) {
            $quote->tags = $data['tags'];
        }

        $quote->save();

        if ($changes) {
            ActivityLog::record($user->id, 'quote_edited', "{$quote->quote_id}: updated ".implode(', ', $changes));
        }

        return response()->json($quote->toApi());
    }

    // PUT /api/quotes/{quote}/status (#43,#53)
    public function updateStatus(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $status = $request->input('status');
        if (!in_array($status, AppConstants::STATUS_OPTIONS, true)) {
            return response()->json(['error' => 'invalid status'], 400);
        }

        $quote->update(['status' => $status]);
        StatusHistory::create([
            'quote_id'   => $quote->id,
            'status'     => $status,
            'changed_by' => $request->user()->id,
            'changed_at' => now(),
        ]);
        ActivityLog::record($request->user()->id, 'status_changed', "{$quote->quote_id} -> {$status}");

        return response()->json($quote->toApi());
    }

    // PUT /api/quotes/{quote}/tags (#44)
    public function updateTags(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $tags = $request->input('tags', []);
        if (!is_array($tags) || array_diff($tags, AppConstants::STATUS_OPTIONS)) {
            return response()->json(['error' => 'invalid tags'], 400);
        }
        $quote->update(['tags' => array_values($tags)]);

        return response()->json($quote->toApi());
    }

    // DELETE /api/quotes/{quote} (#51)
    public function destroy(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $qid = $quote->quote_id;
        // FK cascade handles status_history / orders / payments / quote_items
        $quote->delete();
        ActivityLog::record($request->user()->id, 'quote_deleted', $qid);

        return response()->json(['ok' => true]);
    }

    // GET /api/next-order-id (#119)
    public function nextOrderId(): JsonResponse
    {
        return response()->json(['order_id' => Setting::nextOrderId()]);
    }

    // GET /api/quotes/{quote}/generated — full editor/wizard state (#19,#71)
    public function getGenerated(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        return response()->json($quote->generated_data ?: (object) []);
    }

    // PUT /api/quotes/{quote}/generated — save wizard/editor progress (V1 generated_data)
    public function putGenerated(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $data = $request->all();

        // Merge into the existing bundle (top-level keys) so a partial save never wipes the rest.
        $data = array_merge($quote->generated_data ?? [], $data);
        $quote->generated_data = $data;
        if (in_array($data['quote_type'] ?? null, ['generator', 'custom'], true)) {
            $quote->quote_type = $data['quote_type'];
        }
        $answers = $data['answers'] ?? [];
        if (isset($answers['price']) && $answers['price'] !== '' && is_numeric($answers['price'])) {
            $quote->price = min(10000000, max(0, (float) $answers['price']));   // clamp to a sane range
        }
        // a junk payment link would ship a dead button on the customer's proposal
        if (!empty($data['payment_link']) && !preg_match('#^https?://\S+\.\S+#i', $data['payment_link'])) {
            unset($data['payment_link']);
            $quote->generated_data = $data;
        }
        if (!empty($data['job_name'])) {
            $quote->job_name = $data['job_name'];
        }
        if (!$quote->final_created_by) {
            $quote->final_created_by = $request->user()->id;
        }
        $quote->save();

        return response()->json(['ok' => true]);
    }

    // POST /api/quotes/{quote}/pdf — customer PDF/image (#37 replace)
    /**
     * Store an uploaded file permanently. Cloudinary first (permanent CDN, survives redeploys —
     * the local disk on Render is EPHEMERAL and wiped every deploy, which is how the team lost
     * their old drawings); local public disk only as the no-Cloudinary fallback.
     * Returns [dbValue, publicPath] or null when nothing could be saved.
     */
    private function storeUploadPermanently($file, string $dir, string $filename): ?array
    {
        if (CloudinaryService::configured()) {
            $url = CloudinaryService::upload($file->getRealPath(), "epic-quote/{$dir}", 'auto');
            if ($url) {
                return [$url, $url];
            }
            return null; // configured but failed — caller returns a clear error, never silently ephemeral
        }
        $file->storeAs($dir, $filename, 'public');
        if (!Storage::disk('public')->exists("{$dir}/{$filename}")) {
            return null;
        }
        return [$filename, "/storage/{$dir}/{$filename}"];
    }

    public function uploadPdf(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $request->validate(['file' => 'required|file|mimes:pdf,jpg,jpeg,png,gif,webp,avif,svg|max:25600']);
        $file = $request->file('file');
        $filename = $quote->quote_id.'_'.$this->safeFilename($file);
        $stored = $this->storeUploadPermanently($file, 'pdfs', $filename);
        if (!$stored) {
            return response()->json(['error' => 'Upload could not be saved — check Cloudinary/storage configuration.'], 502);
        }
        $quote->update(['customer_pdf' => $stored[0]]);
        ActivityLog::record($request->user()->id, 'file_uploaded', "{$quote->quote_id}: Customer PDF/Drawing ({$filename})");

        return response()->json(['path' => $stored[1]]);
    }

    // POST /api/quotes/{quote}/extra-file — an additional (non-primary) upload so multi-file jobs
    // lose nothing. Stored alongside the primary; the frontend records the path in generated_data.
    public function uploadExtraFile(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $request->validate(['file' => 'required|file|mimes:pdf,jpg,jpeg,png,gif,webp,avif,svg|max:25600']);
        $file = $request->file('file');
        $filename = $quote->quote_id.'_x'.substr(md5((string) microtime(true)), 0, 6).'_'.$this->safeFilename($file);
        $stored = $this->storeUploadPermanently($file, 'pdfs', $filename);
        if (!$stored) {
            return response()->json(['error' => 'Upload could not be saved — check Cloudinary/storage configuration.'], 502);
        }
        ActivityLog::record($request->user()->id, 'file_uploaded', "{$quote->quote_id}: Extra upload ({$filename})");

        return response()->json(['path' => $stored[1]]);
    }

    // POST /api/quotes/{quote}/artwork — artwork image (#67); path saved into generated_data
    public function uploadArtwork(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $request->validate(['file' => 'required|file|mimes:jpg,jpeg,png,gif,webp,avif,svg|max:25600']);
        $file = $request->file('file');
        $ext = $file->getClientOriginalExtension();
        $filename = $quote->quote_id.'_'.time().'.'.$ext;

        // Cloudinary (permanent CDN URL, shared across instances). If it's configured we REQUIRE it to
        // succeed (a failure returns a clear error instead of silently dropping to the broken local disk).
        if (CloudinaryService::configured()) {
            $url = CloudinaryService::upload($file->getRealPath(), 'epic-quote/artwork', 'image');
            if (!$url) {
                return response()->json(['error' => 'Cloudinary is configured but the upload failed — verify CLOUDINARY_URL.'], 502);
            }
        } else {
            $file->storeAs('artwork', $filename, 'public');
            if (!Storage::disk('public')->exists("artwork/{$filename}")) {
                return response()->json(['error' => 'Cloudinary not configured and local storage is not writable.'], 500);
            }
            $url = "/storage/artwork/{$filename}";
        }
        ActivityLog::record($request->user()->id, 'file_uploaded', "{$quote->quote_id}: Artwork ({$filename})");

        return response()->json(['path' => $url]);
    }

    // POST /api/quotes/{quote}/crunched-artwork — image or PDF (#123)
    public function uploadCrunchedArtwork(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $request->validate(['file' => 'required|file|mimes:pdf,jpg,jpeg,png,gif,webp,avif,svg|max:25600']);
        $file = $request->file('file');
        $ext = $file->getClientOriginalExtension();
        $filename = "crunched_{$quote->quote_id}_".time().".{$ext}";
        $stored = $this->storeUploadPermanently($file, 'artwork', $filename);
        if (!$stored) {
            return response()->json(['error' => 'Upload could not be saved — check Cloudinary/storage configuration.'], 502);
        }
        $quote->update(['crunched_artwork' => $stored[0]]);
        ActivityLog::record($request->user()->id, 'file_uploaded', "{$quote->quote_id}: Crunched Dimension Artwork ({$filename})");

        return response()->json(['path' => $stored[1]]);
    }

    // --- Deferred to later phases (routes exist; not yet implemented) ---
    public function getPaymentLink()       { return $this->pending('P8 payments'); }
    public function putPaymentLink()       { return $this->pending('P8 payments'); }
    public function confirmOrder()         { return $this->pending('P8 order confirmation'); }
    public function downloadPdf()          { return $this->pending('P7 PDF generation'); }

    private function pending(string $phase): JsonResponse
    {
        return response()->json(['error' => "Not implemented yet — {$phase}"], 501);
    }

    private function safeFilename(\Illuminate\Http\UploadedFile $file): string
    {
        // strip directory components + unsafe chars (prevents path traversal / odd names)
        return preg_replace('/[^A-Za-z0-9._-]/', '_', basename($file->getClientOriginalName()));
    }

    private function assertAccess(Request $request, Quote $quote): void
    {
        if (!$quote->isVisibleTo($request->user())) {
            abort(403);
        }
    }
}
