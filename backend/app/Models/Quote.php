<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Quote extends Model
{
    use HasFactory;

    protected $fillable = [
        'quote_id', 'order_id', 'quote_num',
        'company_id', 'company_name', 'client_name', 'contact', 'email', 'address',
        'job_name', 'special_requirements', 'customer_pdf',
        'sales_rep', 'quote_source', 'status', 'tags', 'price',
        'quote_type', 'generated_data', 'crunched_artwork',
        'payment_link', 'order_confirmed', 'order_placed_at',
        'revision_notes', 'important_notes', 'internal_notes',
        'airtable_id', 'assigned_to', 'rush', 'breakeven_production', 'breakeven_shipping',
        'price_approved', 'approved_by', 'approved_at', 'approval_locked', 'followup_sent', 'followup_notes', 'is_test',
        'created_by', 'final_created_by',
    ];

    protected function casts(): array
    {
        return [
            'tags'            => 'array',
            'generated_data'  => 'array',
            'price'           => 'float',
            'order_confirmed' => 'boolean',
            'is_test'         => 'boolean',
            'approved_at'     => 'datetime',
            'order_placed_at' => 'datetime',
        ];
    }

    protected $attributes = [
        'status'          => 'To Do',
        'order_confirmed' => false,
    ];

    // V1 routes quotes by the string quote_id (e.g. EC100001), not the numeric pk
    public function getRouteKeyName(): string
    {
        return 'quote_id';
    }

    // Non-admins see quotes they OWN (sales_rep) or are ASSIGNED (assigned_to). Repless
    // quotes (no sales rep = "N/A") are shared work, visible to the whole team (#13).
    public function scopeVisibleTo($query, User $user)
    {
        if (!$user->seesAllQuotes()) {
            $query->where(function ($q) use ($user) {
                $q->where('sales_rep', $user->full_name)
                  ->orWhere('assigned_to', $user->full_name)
                  ->orWhereNull('sales_rep')
                  ->orWhere('sales_rep', '');
            });
        }
        return $query;
    }

    public function isVisibleTo(User $user): bool
    {
        return $user->seesAllQuotes()
            || $this->sales_rep === $user->full_name
            || $this->assigned_to === $user->full_name
            || (string) ($this->sales_rep ?? '') === '';   // repless = team-wide (#13)
    }

    // V1 serialize_quote()
    public function toApi(bool $includeGenerated = false): array
    {
        $gd = $this->generated_data ?: [];

        $data = [
            'id'                   => $this->id,
            'quote_id'             => $this->quote_id,
            'order_id'             => $this->order_id ?: '',
            'company_id'           => $this->company_id,
            'company_name'         => $this->company_name,
            'client_name'          => $this->client_name,
            'contact'              => $this->contact,
            'email'                => $this->email,
            'address'              => $this->address,
            'job_name'             => $this->job_name,
            'special_requirements' => $this->special_requirements,
            'customer_pdf'         => self::fileRef($this->customer_pdf, 'pdfs'),
            'sales_rep'            => $this->sales_rep,
            'quote_source'         => $this->quote_source,
            'status'               => $this->status,
            'tags'                 => $this->tags ?: [],
            'price'                => $this->price,
            'quote_type'           => $this->quote_type,
            'artwork_url'          => $gd['artwork_path'] ?? null,
            'crunched_artwork'     => self::fileRef($this->crunched_artwork, 'artwork'),
            'added_by'             => $this->creator?->full_name ?? '',
            'created_by_name'      => $this->finalCreator?->full_name ?? '',
            'payment_link'         => $this->payment_link,
            'assigned_to'          => $this->assigned_to ?? '',
            'rush'                 => $this->rush ?? '',
            'breakeven_production' => $this->breakeven_production,
            'breakeven_shipping'   => $this->breakeven_shipping,
            'profit'               => $this->profit(),
            'profit_pct'           => $this->profitPct(),
            'price_approved'       => (bool) $this->price_approved,
            'approved_by'          => $this->approved_by ?? '',
            'approved_at'          => $this->approved_at?->toIso8601String(),
            'approval_locked'      => (bool) $this->approval_locked,
            'followup_sent'        => (bool) $this->followup_sent,
            'followup_notes'       => $this->followup_notes,
            'is_test'              => (bool) $this->is_test,
            'order_confirmed'      => $this->order_confirmed,
            'order_placed_at'      => $this->order_placed_at?->toIso8601String(),
            'revision_notes'       => $this->revision_notes ?? '',
            'important_notes'      => $this->important_notes ?? '',
            'internal_notes'       => $this->internal_notes ?? '',
            'done_at'              => $this->firstDoneAt()?->toIso8601String(),
            'days_to_done'         => $this->daysToDone(),
            'created_at'           => $this->created_at?->toIso8601String(),
            'updated_at'           => $this->updated_at?->toIso8601String(),
        ];

        if ($includeGenerated) {
            $data['generated_data'] = $gd ?: null;
        }

        return $data;
    }

    /**
     * Auto profit = price − (breakeven production + shipping). Internal only.
     * Null until a price AND at least one breakeven exist — profit without
     * costs entered would just echo the price and mislead.
     */
    public function profit(): ?float
    {
        $hasBe = $this->breakeven_production !== null || $this->breakeven_shipping !== null;
        if (!$hasBe || !$this->price) {
            return null;
        }
        return round((float) $this->price - (float) ($this->breakeven_production ?? 0) - (float) ($this->breakeven_shipping ?? 0), 2);
    }

    /**
     * Real time-to-Done (T16): from creation to the FIRST time the quote hit "Done"
     * in status history. Null while it has never been Done.
     */
    public function firstDoneAt(): ?\Illuminate\Support\Carbon
    {
        $rows = $this->relationLoaded('statusHistory') ? $this->statusHistory : $this->statusHistory()->get();
        $done = $rows->where('status', 'Done')->sortBy('changed_at')->first();
        return $done?->changed_at ? \Illuminate\Support\Carbon::parse($done->changed_at) : null;
    }

    public function daysToDone(): ?float
    {
        $done = $this->firstDoneAt();
        if (!$done || !$this->created_at) {
            return null;
        }
        return round($this->created_at->diffInMinutes($done) / 1440, 1);
    }

    public function profitPct(): ?float
    {
        $p = $this->profit();
        return $p === null ? null : round($p / (float) $this->price * 100, 1);
    }

    /**
     * Public reference for a stored file column. Absolute URLs (Cloudinary CDN — permanent,
     * survives redeploys) pass through untouched; bare filenames get the local /storage prefix.
     */
    public static function fileRef(?string $value, string $dir): ?string
    {
        if (!$value) {
            return null;
        }
        return preg_match('#^https?://#i', $value) ? $value : "/storage/{$dir}/{$value}";
    }

    // Relationships
    public function company()
    {
        return $this->belongsTo(Company::class);
    }

    public function items()
    {
        return $this->hasMany(QuoteItem::class)->orderBy('position');
    }

    public function statusHistory()
    {
        return $this->hasMany(StatusHistory::class)->latest('changed_at');
    }

    public function order()
    {
        return $this->hasOne(Order::class);
    }

    public function payment()
    {
        return $this->hasOne(Payment::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function finalCreator()
    {
        return $this->belongsTo(User::class, 'final_created_by');
    }
}
