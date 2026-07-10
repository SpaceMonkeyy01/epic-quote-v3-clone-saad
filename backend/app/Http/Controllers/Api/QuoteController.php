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
    /** Hard maximum any single quote may be priced at. Real jobs go into 6 digits (per the
     *  meeting), so the cap is a sanity guard against typos, not a business limit. */
    public const MAX_QUOTE_PRICE = 1000000;

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

        // "Assigned to" filter: ?assigned=me → quotes assigned to the current user,
        // ?assigned=<name> → that person's quotes (Airtable's "Assign to" view)
        if ($assigned = trim((string) $request->query('assigned', ''))) {
            $q->where('assigned_to', $assigned === 'me' ? $request->user()->full_name : $assigned);
        }

        // Quote-source filter (?source=Email …)
        if ($source = trim((string) $request->query('source', ''))) {
            $q->where('quote_source', $source);
        }

        // Rush filter: ?rush=1 → any rush level, ?rush=Rush / ?rush=Super Rush → exact
        if ($rush = trim((string) $request->query('rush', ''))) {
            $rush === '1'
                ? $q->whereIn('rush', ['Rush', 'Super Rush'])
                : $q->where('rush', $rush);
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

        $quotes = $q->with('statusHistory')->latest('created_at')->get()->map->toApi();

        return response()->json($quotes);
    }

    // GET /api/companies/suggest?q= — known companies for intake autofill (#12).
    // Returns the most recent quote's details per matching company so typing a repeat
    // customer ("Signarama", "Mountain Dog") prefills address + last client/phone/email.
    public function companySuggest(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        if ($q === '') {
            return response()->json([]);
        }
        // Read from the canonical Companies + Representatives tables (the shared customer DB,
        // incl. the Airtable import) — NOT from quote rows, which were the source of the
        // cross-contamination blunder (#15). Each company returns ALL of its own saved contacts,
        // so nothing hides behind "the most complete one", and one company never shows another's.
        $rows = Company::where('name', 'like', '%'.$q.'%')
            ->orderBy('name')
            ->limit(10)
            ->get(['id', 'name', 'address'])
            ->map(function ($c) {
                // normalize whitespace (incl. non-breaking spaces) so "Sharon Khoo" doesn't show 3×
                $norm = fn ($s) => trim(preg_replace('/\s+/u', ' ', str_replace("\u{00A0}", ' ', (string) $s)));
                $contacts = Representative::where('company_id', $c->id)
                    ->orderByDesc('id')
                    ->get(['name', 'phone', 'email'])
                    ->map(fn ($r) => [
                        'client_name' => $norm($r->name),
                        'contact'     => $norm($r->phone),
                        'email'       => $norm($r->email),
                    ])
                    ->filter(fn ($c) => $c['client_name'] !== '' || $c['contact'] !== '' || $c['email'] !== '')
                    ->unique(fn ($c) => mb_strtolower($c['client_name'].'|'.$c['email']))
                    ->values();
                return [
                    'name'     => $c->name,
                    'address'  => (string) ($c->address ?? ''),
                    'contacts' => $contacts,
                ];
            })
            ->values();

        return response()->json($rows);
    }

    // POST /api/quotes — Add Quote (#33-37)
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        $companyName = trim((string) $request->input('company_name', ''));
        $clientName  = trim((string) $request->input('client_name', ''));
        $contact     = self::phoneOnly($request->input('contact', ''));   // phone: digits only (#22)
        $email       = trim((string) $request->input('email', ''));
        $address     = trim((string) $request->input('address', ''));
        $jobName     = trim((string) $request->input('job_name', ''));
        $special     = trim((string) $request->input('special_requirements', ''));
        $salesRep    = trim((string) $request->input('sales_rep', ''));
        $quoteSource = (string) $request->input('quote_source', '');
        $orderId     = trim((string) $request->input('order_id', ''));
        $qid         = strtoupper(trim((string) $request->input('quote_id', '')));  // IDs are case-insensitive → normalize
        $updateCompanyAddr = $request->boolean('update_company_address');   // (#5) rep confirmed overwriting the saved address

        // Non-admins may leave the rep blank (N/A → shared quote) or own it themselves,
        // but can never assign it to somebody else.
        if (!$user->isAdmin() && $salesRep !== '') {
            $salesRep = $user->full_name;
        }

        // --- validation ---
        // Company is optional: AI mode is PDF-first and fills it from the drawing (workstream B).
        // Sales rep is OPTIONAL now (#13): blank = N/A. Only cap the length when one is given.
        if (mb_strlen($salesRep) > 80) {
            return response()->json(['error' => 'Sales Representative name is too long (max 80 chars)'], 400);
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
            $companyName, $clientName, $contact, $email, $address, $jobName, $special,
            $salesRep, $quoteSource, $orderId, $qid, $file, $user, $updateCompanyAddr
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
                } elseif ($address && (!$company->address || $updateCompanyAddr)) {
                    // fill a blank address automatically, OR overwrite an existing one when the
                    // rep explicitly confirmed the update in the intake (#5).
                    $company->update(['address' => $address]);
                }

                // auto-create/refresh the representative for this client (#35). Store phone and
                // email in their OWN columns (the phone used to be written into `email`), and
                // backfill blanks on an existing rep so contact details accumulate, never lost.
                if ($clientName !== '') {
                    $rep = Representative::where('company_id', $company->id)
                        ->whereRaw('LOWER(name) = ?', [strtolower($clientName)])->first();
                    if (!$rep) {
                        Representative::create([
                            'company_id' => $company->id, 'name' => $clientName,
                            'phone' => $contact, 'email' => $email,
                        ]);
                    } else {
                        $patch = [];
                        if ($contact !== '' && !$rep->phone) $patch['phone'] = $contact;
                        if ($email !== '' && !$rep->email) $patch['email'] = $email;
                        if ($patch) $rep->update($patch);
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
                'email'                => $email,
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
        // keep the team's Airtable in step (no-op until AIRTABLE_* env vars are set)
        \App\Services\AirtableQuoteSync::pushQuote($quote);

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
            $newRep = trim((string) $data['sales_rep']);   // '' = N/A (#13)
            if (mb_strlen($newRep) > 80) {
                return response()->json(['error' => 'Sales Representative name is too long (max 80 chars)'], 400);
            }
            if ($newRep !== (string) $quote->sales_rep) {
                $changes[] = 'Sales Rep: '.($quote->sales_rep ?: 'N/A').' -> '.($newRep ?: 'N/A');
                $quote->sales_rep = $newRep;
            }
        }

        if (array_key_exists('quote_source', $data)) {
            // '' clears the source ("not sure") — same as intake allows
            $data['quote_source'] = (string) ($data['quote_source'] ?? '');
            if ($data['quote_source'] !== '' && !in_array($data['quote_source'], AppConstants::QUOTE_SOURCES, true)) {
                return response()->json(['error' => 'Invalid Quote Source'], 400);
            }
            if ($data['quote_source'] !== $quote->quote_source) {
                $changes[] = 'Quote Source';
            }
            $quote->quote_source = $data['quote_source'];
        }

        foreach (['client_name', 'contact', 'email', 'address', 'job_name', 'special_requirements', 'company_name', 'order_id'] as $field) {
            if (array_key_exists($field, $data)) {
                // ConvertEmptyStringsToNull turns '' into null; these columns are NOT NULL
                // default '' (V1 stored '', never null), so coalesce back to ''.
                $value = $data[$field] ?? '';
                if ($field === 'contact') {
                    $value = self::phoneOnly($value);   // contact = phone number, digits only (#22)
                }
                if ((string) ($quote->{$field} ?? '') !== (string) $value) {
                    $changes[] = ucwords(str_replace('_', ' ', $field));
                }
                $quote->{$field} = $value;
            }
        }

        if (array_key_exists('price', $data) && is_numeric($data['price'])) {
            $newPrice = (float) $data['price'];
            if ($newPrice < 0 || $newPrice > self::MAX_QUOTE_PRICE) {
                return response()->json(['error' => 'Price must be between $0 and $'.number_format(self::MAX_QUOTE_PRICE).'.'], 422);
            }
            if ($newPrice !== (float) ($quote->price ?? 0)) {
                $changes[] = 'Final Price';
            }
            $quote->price = $newPrice;
        }

        if (array_key_exists('tags', $data) && is_array($data['tags'])) {
            $quote->tags = $data['tags'];
        }

        // Anyone who can see the quote can (re)assign it — the team hands work to each
        // other constantly; every change is still logged below.
        if (array_key_exists('assigned_to', $data)) {
            $newAssignee = trim((string) ($data['assigned_to'] ?? ''));
            if (mb_strlen($newAssignee) > 80) {
                return response()->json(['error' => 'Assignee name must be 80 characters or fewer'], 400);
            }
            if ($newAssignee !== (string) ($quote->assigned_to ?? '')) {
                $changes[] = 'Assigned to: '.($quote->assigned_to ?: '—').' -> '.($newAssignee ?: '—');
                $quote->assigned_to = $newAssignee;
            }
        }

        // The three note lanes (T12): revision asks, must-not-miss, internal-only.
        foreach (['revision_notes', 'important_notes', 'internal_notes'] as $noteField) {
            if (array_key_exists($noteField, $data)) {
                $val = (string) ($data[$noteField] ?? '');
                if (mb_strlen($val) > 5000) {
                    return response()->json(['error' => 'Notes must be 5000 characters or fewer'], 400);
                }
                if ($val !== (string) ($quote->{$noteField} ?? '')) {
                    $changes[] = ucwords(str_replace('_', ' ', $noteField)).' updated';
                }
                $quote->{$noteField} = $val;
            }
        }

        // Order placed (T13): the marker stamps the date; unmarking clears it.
        if (array_key_exists('order_confirmed', $data)) {
            $placed = (bool) $data['order_confirmed'];
            if ($placed !== (bool) $quote->order_confirmed) {
                $quote->order_confirmed = $placed;
                $quote->order_placed_at = $placed ? now() : null;
                $changes[] = $placed ? 'ORDER PLACED' : 'Order-placed mark removed';
            }
        }

        // Follow-ups: sent flag + free notes. Marking sent is logged with who did it.
        if (array_key_exists('followup_sent', $data)) {
            $sent = (bool) $data['followup_sent'];
            if ($sent !== (bool) $quote->followup_sent) {
                $quote->followup_sent = $sent;
                $changes[] = $sent ? 'Follow-up marked SENT' : 'Follow-up re-opened';
            }
        }
        if (array_key_exists('followup_notes', $data)) {
            $notes = (string) ($data['followup_notes'] ?? '');
            if (mb_strlen($notes) > 2000) {
                return response()->json(['error' => 'Follow-up notes must be 2000 characters or fewer'], 400);
            }
            if ($notes !== (string) ($quote->followup_notes ?? '')) {
                $changes[] = 'Follow-up notes updated';
            }
            $quote->followup_notes = $notes;
        }

        // Price approval: who approved and when are stamped server-side, never client-supplied.
        if (array_key_exists('price_approved', $data)) {
            $approved = (bool) $data['price_approved'];
            if ($approved !== (bool) $quote->price_approved) {
                $quote->price_approved = $approved;
                if ($approved) {
                    $quote->approved_by = $user->full_name;
                    $quote->approved_at = now();
                    $changes[] = 'Price APPROVED by '.$user->full_name;
                } else {
                    $quote->approved_by = '';
                    $quote->approved_at = null;
                    $changes[] = 'Price approval REMOVED';
                }
            }
        }

        // Approval lock: while locked and unapproved, the quote cannot go out
        // (PDF/PNG export and payment links are blocked).
        if (array_key_exists('approval_locked', $data)) {
            $locked = (bool) $data['approval_locked'];
            if ($locked !== (bool) $quote->approval_locked) {
                $quote->approval_locked = $locked;
                $changes[] = $locked ? 'Approval lock ON' : 'Approval lock OFF';
            }
        }

        // Breakeven costs (internal only — never on the proposal/PDF). Profit is derived
        // from these in toApi so every screen computes it the same way.
        foreach (['breakeven_production', 'breakeven_shipping'] as $beField) {
            if (array_key_exists($beField, $data)) {
                $raw = $data[$beField];
                if ($raw === null || $raw === '') {
                    if ($quote->{$beField} !== null) {
                        $changes[] = ucwords(str_replace('_', ' ', $beField)).' cleared';
                    }
                    $quote->{$beField} = null;
                } elseif (is_numeric($raw)) {
                    $val = (float) $raw;
                    if ($val < 0 || $val > 10000000) {
                        return response()->json(['error' => 'Breakeven must be between $0 and $10,000,000.'], 422);
                    }
                    if ($val !== (float) ($quote->{$beField} ?? -1)) {
                        $changes[] = ucwords(str_replace('_', ' ', $beField)).": {$val}";
                    }
                    $quote->{$beField} = $val;
                } else {
                    return response()->json(['error' => 'Breakeven must be a number.'], 422);
                }
            }
        }

        if (array_key_exists('rush', $data)) {
            $newRush = trim((string) ($data['rush'] ?? ''));
            if (!in_array($newRush, ['', 'Rush', 'Super Rush'], true)) {
                return response()->json(['error' => 'Rush must be empty, "Rush" or "Super Rush"'], 400);
            }
            if ($newRush !== (string) ($quote->rush ?? '')) {
                $changes[] = 'Rush: '.($quote->rush ?: '—').' -> '.($newRush ?: '—');
                $quote->rush = $newRush;
            }
        }

        if (array_key_exists('is_test', $data)) {
            $quote->is_test = (bool) $data['is_test'];
            $changes[] = $quote->is_test ? 'Marked as TEST quote' : 'Unmarked TEST quote';
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
        \App\Services\AirtableQuoteSync::pushQuote($quote);

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

    // DELETE /api/quotes/{quote} (#51) — admins only (#7): deleting a quote is destructive
    // and permanent, so it is never available to reps/makers/viewers.
    public function destroy(Request $request, Quote $quote): JsonResponse
    {
        if (!$request->user()->isAdmin()) {
            return response()->json(['error' => 'Only admins can delete quotes.'], 403);
        }
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

        // Hard size cap: generated_data holds the whole editor state, but it must never
        // become an unbounded dumping ground (storage abuse / slow reads).
        if (strlen(json_encode($data)) > 2_000_000) {
            return response()->json(['error' => 'Saved design is too large.'], 413);
        }

        // Defence in depth against stored XSS: the proposal writes these values into the DOM
        // with innerHTML on the client. The client sanitizes on render, but we also strip the
        // dangerous bits here so a poisoned value never even reaches the database.
        $data = $this->stripActiveHtml($data);

        // Merge into the existing bundle (top-level keys) so a partial save never wipes the rest.
        $data = array_merge($quote->generated_data ?? [], $data);
        $quote->generated_data = $data;
        if (in_array($data['quote_type'] ?? null, ['generator', 'custom'], true)) {
            $quote->quote_type = $data['quote_type'];
        }
        // Keep quote.price in sync with whichever mode holds the price: AI wizard = answers.price,
        // custom mode = custom_spec.price. (Custom mode used to leave quote.price at 0, which broke
        // payment-link creation.)
        $answers = $data['answers'] ?? [];
        $priceIn = null;
        if (isset($answers['price']) && $answers['price'] !== '' && is_numeric($answers['price'])) {
            $priceIn = $answers['price'];
        } elseif (isset($data['custom_spec']['price']) && $data['custom_spec']['price'] !== '' && is_numeric($data['custom_spec']['price'])) {
            $priceIn = $data['custom_spec']['price'];
        }
        if ($priceIn !== null) {
            // quote.price = the GRAND TOTAL: unit price × quantity, plus every extra line item
            // (qty × unit) added on the proposal. Payment links and dashboards read this figure.
            $qty = (int) ($data['proposal_state']['__qty'] ?? $data['custom_spec']['qty'] ?? $data['answers']['qty'] ?? 1);
            $qty = max(1, $qty);
            $extras = 0.0;
            foreach ((array) ($data['proposal_state']['__items'] ?? []) as $it) {
                $extras += max(0, (float) ($it['qty'] ?? 1)) * max(0, (float) ($it['unit'] ?? 0));
            }
            // hard cap as a typo safety net; the wizard also blocks it up front with a message.
            $quote->price = min(self::MAX_QUOTE_PRICE, max(0, (float) $priceIn * $qty + $extras));
        }
        // a junk payment link would ship a dead button on the customer's proposal
        if (!empty($data['payment_link']) && !preg_match('#^https?://\S+\.\S+#i', $data['payment_link'])) {
            unset($data['payment_link']);
            $quote->generated_data = $data;
        }
        // approval lock: an unapproved locked quote must not carry a payment link out the door.
        // Stripped (not 422) so routine autosaves keep working; the UI explains the block.
        if (!empty($data['payment_link']) && $quote->approval_locked && !$quote->price_approved) {
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

    // GET /api/quotes/{quote}/revisions — the version history for this quote: changes grouped under
    // checkpoints ({quote_id}-rev{n}, minted on payment / manual save), each checkpoint carrying one
    // proposal image. Changes made after the last checkpoint come back under "pending".
    public function revisions(Request $request, Quote $quote): JsonResponse
    {
        if (!$quote->isVisibleTo($request->user())) {
            return response()->json(['error' => 'forbidden'], 403);
        }

        // chronological within a group so a checkpoint reads oldest→newest change
        $revs = \App\Models\QuoteRevision::where('quote_id', $quote->id)
            ->orderBy('created_at')
            ->limit(1000)
            ->get()
            ->groupBy('checkpoint_id');

        $checkpoints = \App\Models\QuoteCheckpoint::where('quote_id', $quote->id)
            ->orderByDesc('seq')            // newest version on top
            ->get()
            ->map(fn ($cp) => $cp->toApi(
                ($revs->get($cp->id) ?? collect())->map->toApi()->values()->all()
            ))
            ->values();

        // uncheckpointed edits (after the last payment) — most recent first
        $pending = ($revs->get(null) ?? collect())->sortByDesc('created_at')->map->toApi()->values();

        return response()->json(['checkpoints' => $checkpoints, 'pending' => $pending]);
    }

    // POST /api/quotes/{quote}/checkpoints — manual "Save checkpoint" button. Mints {quote_id}-rev{n},
    // folds in every pending change, and (optionally) stores the rendered proposal image.
    public function createCheckpoint(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $cp = \App\Services\CheckpointService::mint($quote, $request->user(), 'manual');

        $img = (string) $request->input('image', '');
        if ($img !== '') {
            $url = $this->storeDataUrlPermanently($img, 'revisions', "cp_{$quote->quote_id}_{$cp->id}.png");
            if ($url) {
                $cp->update(['snapshot_image' => $url]);
            }
        }

        return response()->json([
            'id' => $cp->id, 'label' => $cp->label, 'seq' => $cp->seq, 'snapshot_image' => $cp->snapshot_image,
        ], 201);
    }

    // POST /api/quotes/{quote}/checkpoints/{checkpoint}/image — attach the rendered proposal image to
    // a checkpoint (used right after a payment mints one server-side).
    public function attachCheckpointImage(Request $request, Quote $quote, \App\Models\QuoteCheckpoint $checkpoint): JsonResponse
    {
        $this->assertAccess($request, $quote);
        if ($checkpoint->quote_id !== $quote->id) {
            abort(404);
        }
        $dataUrl = (string) $request->input('image', '');
        if (!preg_match('#^data:image/(png|jpe?g|webp);base64,#i', $dataUrl)) {
            return response()->json(['error' => 'Expected a base64 image data URL.'], 422);
        }
        $url = $this->storeDataUrlPermanently($dataUrl, 'revisions', "cp_{$quote->quote_id}_{$checkpoint->id}.png");
        if (!$url) {
            return response()->json(['error' => 'Snapshot image could not be saved.'], 502);
        }
        $checkpoint->update(['snapshot_image' => $url]);

        return response()->json(['ok' => true, 'snapshot_image' => $url]);
    }

    // POST /api/quotes/{quote}/revisions/snapshot-image — attach a rendered proposal image to the
    // most recent revision, so the history shows the ACTUAL proposal as it looked at that version.
    // The client sends the proposal PNG as a base64 data URL after a save; we store it permanently
    // (Cloudinary → local fallback) and stamp it on the latest revision for this quote.
    public function snapshotImage(Request $request, Quote $quote): JsonResponse
    {
        $this->assertAccess($request, $quote);
        $dataUrl = (string) $request->input('image', '');
        if (!preg_match('#^data:image/(png|jpe?g|webp);base64,#i', $dataUrl)) {
            return response()->json(['error' => 'Expected a base64 image data URL.'], 422);
        }

        $rev = \App\Models\QuoteRevision::where('quote_id', $quote->id)->latest('created_at')->first();
        if (!$rev) {
            // No revision yet (nothing changed): nothing to attach to — silently succeed.
            return response()->json(['ok' => true, 'attached' => false]);
        }

        $url = $this->storeDataUrlPermanently($dataUrl, 'revisions', "rev_{$quote->quote_id}_{$rev->id}.png");
        if (!$url) {
            return response()->json(['error' => 'Snapshot image could not be saved.'], 502);
        }
        $rev->update(['snapshot_image' => $url]);

        return response()->json(['ok' => true, 'attached' => true, 'snapshot_image' => $url]);
    }

    // GET /api/revisions/feed — Airtable-style activity feed: one row per visible quote with its
    // LATEST change (who / what / when) and the rendered proposal image, newest change first.
    public function activityFeed(Request $request): JsonResponse
    {
        $user = $request->user();
        $quotes = Quote::query()->visibleTo($user)->get()->keyBy('id');
        if ($quotes->isEmpty()) {
            return response()->json([]);
        }

        // latest revision per quote (one query, grouped in memory)
        $latest = \App\Models\QuoteRevision::whereIn('quote_id', $quotes->keys())
            ->orderByDesc('created_at')
            ->get()
            ->groupBy('quote_id')
            ->map(fn ($g) => $g->first());

        // latest checkpoint per quote → its rev label + proposal image (image lives on checkpoints now)
        $latestCp = \App\Models\QuoteCheckpoint::whereIn('quote_id', $quotes->keys())
            ->orderByDesc('seq')
            ->get()
            ->groupBy('quote_id')
            ->map(fn ($g) => $g->first());

        $rows = $quotes->map(function ($q) use ($latest, $latestCp) {
            $rev = $latest->get($q->id);
            $cp = $latestCp->get($q->id);
            $changes = $rev?->field_changes ?: [];
            $first = $changes[0] ?? null;
            return [
                'quote_id'       => $q->quote_id,
                'company'        => $q->company_name ?: '—',
                'job_name'       => $q->job_name ?: '',
                'status'         => $q->status,
                'price'          => (float) $q->price,
                'assigned_to'    => $q->assigned_to ?: '',
                'last_change'    => $first ? self::summariseChange($first) : null,
                'change_count'   => count($changes),
                'changed_by'     => $rev?->user_name ?: null,
                'changed_at'     => optional($rev?->created_at)->toIso8601String(),
                'rev_label'      => $cp?->label,
                'snapshot_image' => $cp?->snapshot_image ?? $rev?->snapshot_image,
            ];
        })->values()
          // newest change first; quotes never edited (no changed_at) sink to the bottom
          ->sortByDesc(fn ($r) => $r['changed_at'] ?? '')
          ->values();

        return response()->json($rows);
    }

    /** One-line "Field: old → new" (or "created") summary of a single change entry, for the feed. */
    private static function summariseChange(array $c): string
    {
        if (($c['field'] ?? '') === '__created') {
            return 'Quote created';
        }
        $label = $c['label'] ?? ($c['field'] ?? 'Changed');
        $old = trim((string) ($c['old'] ?? ''));
        $new = trim((string) ($c['new'] ?? ''));
        // opaque edits (images, layout, swatches) diff to "(edited)" both sides — show just the label
        if ($old === $new || ($old === '' && $new === '')) {
            return $label.' edited';
        }
        return $label.': '.($old === '' ? '—' : $old).' → '.($new === '' ? '—' : $new);
    }

    /** Store a base64 image data URL permanently (Cloudinary → local public fallback). */
    private function storeDataUrlPermanently(string $dataUrl, string $dir, string $filename): ?string
    {
        [$meta, $b64] = explode(',', $dataUrl, 2) + [null, null];
        $bytes = base64_decode((string) $b64, true);
        if ($bytes === false || strlen($bytes) === 0) {
            return null;
        }
        // hard cap so a runaway capture can't dump a huge blob (proposal PNG ~ a few hundred KB)
        if (strlen($bytes) > 8_000_000) {
            return null;
        }

        if (CloudinaryService::configured()) {
            $tmp = tempnam(sys_get_temp_dir(), 'rev');
            file_put_contents($tmp, $bytes);
            try {
                $url = CloudinaryService::upload($tmp, 'epic-quote/revisions', 'image');
            } finally {
                @unlink($tmp);
            }
            return $url ?: null;
        }

        Storage::disk('public')->put("{$dir}/{$filename}", $bytes);
        return Storage::disk('public')->exists("{$dir}/{$filename}") ? "/storage/{$dir}/{$filename}" : null;
    }

    /**
     * Recursively strip active/executable HTML from every string in a nested array
     * (proposal_state blocks, notes, etc.). Removes <script>/<style> blocks, event-handler
     * attributes (onerror, onclick, …), javascript: URIs and <iframe>/<object>/<embed>/<svg>.
     * Formatting stays intact — this is a safety net behind the client's allow-list sanitizer.
     */
    private function stripActiveHtml(mixed $value): mixed
    {
        if (is_array($value)) {
            return array_map(fn ($v) => $this->stripActiveHtml($v), $value);
        }
        if (!is_string($value) || $value === '' || !str_contains($value, '<') && !str_contains($value, 'javascript:')) {
            return $value;
        }
        $patterns = [
            '#<\s*(script|style|iframe|object|embed|svg|link|meta)\b[^>]*>.*?<\s*/\s*\1\s*>#is',  // paired dangerous tags + body
            '#<\s*(script|iframe|object|embed|svg|link|meta)\b[^>]*/?>#is',                        // self-closing / unclosed
            '#\son\w+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)#i',                                        // on* event handlers
            '#(href|src)\s*=\s*("\s*javascript:[^"]*"|\'\s*javascript:[^\']*\'|javascript:[^\s>]+)#i', // javascript: URIs
        ];
        return preg_replace($patterns, '', $value);
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

    // Contact phone: keep digits and phone punctuation only — never letters (#22).
    public static function phoneOnly(mixed $v): string
    {
        return trim(preg_replace('/[^0-9()+\-.\s]/', '', (string) $v));
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
