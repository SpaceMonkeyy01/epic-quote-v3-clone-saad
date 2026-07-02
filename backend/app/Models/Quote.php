<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Quote extends Model
{
    use HasFactory;

    protected $fillable = [
        'quote_id', 'order_id', 'quote_num',
        'company_id', 'company_name', 'client_name', 'contact', 'address',
        'job_name', 'special_requirements', 'customer_pdf',
        'sales_rep', 'quote_source', 'status', 'tags', 'price',
        'quote_type', 'generated_data', 'crunched_artwork',
        'payment_link', 'order_confirmed',
        'created_by', 'final_created_by',
    ];

    protected function casts(): array
    {
        return [
            'tags'            => 'array',
            'generated_data'  => 'array',
            'price'           => 'float',
            'order_confirmed' => 'boolean',
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

    // V1 get_quote_or_403 / list filter: non-admins see only their own quotes
    public function scopeVisibleTo($query, User $user)
    {
        if (!$user->isAdmin()) {
            $query->where('sales_rep', $user->full_name);
        }
        return $query;
    }

    public function isVisibleTo(User $user): bool
    {
        return $user->isAdmin() || $this->sales_rep === $user->full_name;
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
            'order_confirmed'      => $this->order_confirmed,
            'created_at'           => $this->created_at?->toIso8601String(),
            'updated_at'           => $this->updated_at?->toIso8601String(),
        ];

        if ($includeGenerated) {
            $data['generated_data'] = $gd ?: null;
        }

        return $data;
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
