<?php

namespace App\Services;

use App\Models\Quote;
use App\Models\QuoteCheckpoint;
use App\Models\QuoteRevision;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Mints a checkpoint (a named version, "{quote_id}-rev{seq}") and folds every not-yet-checkpointed
 * change of that quote under it. Called when a payment link is created (trigger 'payment') and from
 * the manual "Save checkpoint" button (trigger 'manual').
 */
class CheckpointService
{
    public static function mint(Quote $quote, ?User $user, string $trigger = 'payment'): QuoteCheckpoint
    {
        return DB::transaction(function () use ($quote, $user, $trigger) {
            // next sequence per quote (row-locked so two near-simultaneous payments can't collide)
            $seq = (int) QuoteCheckpoint::where('quote_id', $quote->id)->lockForUpdate()->max('seq') + 1;

            $cp = QuoteCheckpoint::create([
                'quote_id'   => $quote->id,
                'seq'        => $seq,
                'label'      => $quote->quote_id.'-rev'.$seq,
                'trigger'    => in_array($trigger, ['payment', 'manual'], true) ? $trigger : 'payment',
                'user_id'    => $user?->id,
                'user_name'  => $user?->full_name ?: $user?->username,
                'created_at' => now(),
            ]);

            // fold all pending (uncheckpointed) changes into this version
            QuoteRevision::where('quote_id', $quote->id)
                ->whereNull('checkpoint_id')
                ->update(['checkpoint_id' => $cp->id]);

            return $cp;
        });
    }
}
