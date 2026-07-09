<?php

namespace App\Services;

use App\Models\Quote;
use App\Models\QuoteRevision;
use App\Models\User;
use Illuminate\Support\Arr;

/**
 * Records a field-level revision every time a quote is saved (Airtable-style history).
 *
 *  - Human-readable per-field diff (labels), including deep proposal edits (price, colours,
 *    specification text, artwork image + crop, dimension arrows, swatches, side views, …).
 *  - A full snapshot at each version, so a past state can be restored later.
 *  - Rapid consecutive edits by the SAME user are merged into one revision (a 60s window) so an
 *    editing burst reads as a single entry instead of dozens of autosave rows.
 */
class RevisionRecorder
{
    /** Consolidate edits by the same user within this many seconds into one revision.
     *  0 = never merge → every save that actually changes something is its own row (the chosen behaviour). */
    private const MERGE_WINDOW = 0;

    /** Tracked quote columns → friendly label. */
    private const COLUMNS = [
        'company_name' => 'Company', 'client_name' => 'Client', 'contact' => 'Phone',
        'email' => 'Email', 'address' => 'Address', 'job_name' => 'Job name', 'price' => 'Final price',
        'status' => 'Status', 'assigned_to' => 'Assigned to', 'sales_rep' => 'Sales rep',
        'special_requirements' => 'Special requirements', 'rush' => 'Rush', 'approval_locked' => 'Approval lock',
        'price_approved' => 'Price approved', 'followup_notes' => 'Follow-up notes', 'is_test' => 'Test flag',
    ];

    /** Known generated_data areas (dot paths) → label. Ordered specific-first. */
    private const GD_AREAS = [
        'answers.price' => 'Price', 'custom_spec.price' => 'Price',
        'artwork_path' => 'Artwork image', 'sign_box' => 'Sign measurement box',
        'side_views' => 'Side views', 'payment_link' => 'Payment link',
        'proposal_state.specBody' => 'Specifications text', 'proposal_state.itemDesc' => 'Item description',
        'proposal_state.notes' => 'Additional notes', 'proposal_state.__artBg' => 'Artwork area background',
        'proposal_state.__swatches' => 'Colour swatches', 'proposal_state.__layout.artwork' => 'Artwork position / crop',
        'proposal_state.__layout.dim-w' => 'Width dimension arrow', 'proposal_state.__layout.dim-h' => 'Height dimension arrow',
        'answers' => 'Specifications', 'custom_spec' => 'Custom specifications', 'proposal_state' => 'Proposal edits',
    ];

    /** Pre-save snapshot of the tracked state, keyed per model instance (getOriginal() is synced
     *  to the new values by the time the `updated` event fires, so we must stash the old here). */
    private static array $oldState = [];

    public static function remember(Quote $quote): void
    {
        self::$oldState[spl_object_id($quote)] = [
            'columns'        => array_map(fn ($c) => $quote->getOriginal($c), array_combine(array_keys(self::COLUMNS), array_keys(self::COLUMNS))),
            'generated_data' => self::asArray($quote->getOriginal('generated_data')),
        ];
    }

    public static function record(Quote $quote, ?User $user, bool $created = false): void
    {
        $old = self::$oldState[spl_object_id($quote)] ?? null;
        unset(self::$oldState[spl_object_id($quote)]);
        $changes = $created ? self::createdChanges($quote) : self::diff($quote, $old);
        if (empty($changes)) {
            return;
        }
        $snapshot = self::snapshot($quote);

        $last = self::MERGE_WINDOW > 0 ? QuoteRevision::where('quote_id', $quote->id)->latest('created_at')->first() : null;
        if (self::MERGE_WINDOW > 0 && !$created && $last && $last->user_id === ($user?->id)
            && $last->created_at && $last->created_at->gt(now()->subSeconds(self::MERGE_WINDOW))) {
            // merge into the burst: keep each field's ORIGINAL old, take the latest new + snapshot
            $last->update([
                'field_changes' => self::merge($last->field_changes ?? [], $changes),
                'snapshot'      => $snapshot,
                'created_at'    => now(),
            ]);
            return;
        }

        QuoteRevision::create([
            'quote_id'      => $quote->id,
            'user_id'       => $user?->id,
            'user_name'     => $user?->full_name ?: $user?->username,
            'field_changes' => $changes,
            'snapshot'      => $snapshot,
            'created_at'    => now(),
        ]);
    }

    private static function createdChanges(Quote $quote): array
    {
        return [['field' => '__created', 'label' => 'Quote created', 'old' => null, 'new' => $quote->quote_id]];
    }

    private static function diff(Quote $quote, ?array $oldState): array
    {
        $oldCols = $oldState['columns'] ?? [];
        $out = [];

        // ---- columns ----
        foreach (self::COLUMNS as $col => $label) {
            $old = $oldCols[$col] ?? null;
            $new = $quote->$col;
            if (self::scalarize($old) !== self::scalarize($new)) {
                $out[] = ['field' => $col, 'label' => $label, 'old' => self::display($old), 'new' => self::display($new)];
            }
        }

        // ---- generated_data (deep) ----
        {
            $old = $oldState['generated_data'] ?? [];
            $new = self::asArray($quote->generated_data);
            $seen = [];
            foreach (self::GD_AREAS as $path => $label) {
                // skip a broad area if a more specific child under it already reported a change
                if (self::coveredBy($path, $seen)) {
                    continue;
                }
                $ov = Arr::get($old, $path);
                $nv = Arr::get($new, $path);
                if (json_encode($ov) !== json_encode($nv)) {
                    $out[] = ['field' => $path, 'label' => $label, 'old' => self::display($ov), 'new' => self::display($nv)];
                    $seen[] = $path;
                }
            }
        }

        return $out;
    }

    /** A broad area (e.g. proposal_state) is suppressed once a specific child already changed. */
    private static function coveredBy(string $path, array $seen): bool
    {
        foreach ($seen as $s) {
            if (str_starts_with($s, $path.'.') || $s === $path) {
                // a more specific path was already recorded under this broad one
                if (strlen($s) > strlen($path)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static function merge(array $existing, array $incoming): array
    {
        $byField = [];
        foreach ($existing as $c) {
            $byField[$c['field']] = $c;
        }
        foreach ($incoming as $c) {
            if (isset($byField[$c['field']])) {
                $byField[$c['field']]['new'] = $c['new'];   // keep original old, update to newest new
            } else {
                $byField[$c['field']] = $c;
            }
        }
        return array_values($byField);
    }

    private static function snapshot(Quote $quote): array
    {
        return [
            'columns'        => Arr::only($quote->getAttributes(), array_keys(self::COLUMNS)),
            'generated_data' => self::asArray($quote->generated_data),
        ];
    }

    // ---- helpers ----
    private static function asArray($v): array
    {
        if (is_array($v)) {
            return $v;
        }
        if (is_string($v) && $v !== '') {
            $d = json_decode($v, true);
            return is_array($d) ? $d : [];
        }
        return [];
    }

    private static function scalarize($v): string
    {
        return is_scalar($v) || $v === null ? (string) $v : json_encode($v);
    }

    /** Short, display-safe representation (full detail lives in the snapshot). */
    private static function display($v)
    {
        if ($v === null || $v === '') {
            return '';
        }
        if (is_bool($v)) {
            return $v ? 'yes' : 'no';
        }
        if (is_scalar($v)) {
            $s = (string) $v;
            $s = trim(strip_tags($s));   // spec text is HTML — show plain, trimmed
            return mb_strlen($s) > 120 ? mb_substr($s, 0, 120).'…' : $s;
        }
        // arrays/objects (layout, swatches, side views) — a compact summary, not the raw blob
        return '(edited)';
    }
}
