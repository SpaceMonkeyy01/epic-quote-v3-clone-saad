<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PaymentLink extends Model
{
    protected $fillable = [
        'quote_id', 'title', 'image', 'specs', 'company_name', 'side_view',
        'contact', 'email', 'amount', 'quote_total', 'kind',
        'shopify_product_id', 'shopify_variant_id', 'url',
        'status', 'paid_at', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'amount'      => 'float',
            'quote_total' => 'float',
            'paid_at'     => 'datetime',
        ];
    }

    public function quote()
    {
        return $this->belongsTo(Quote::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function toApi(): array
    {
        return [
            'id'            => $this->id,
            'quote_id'      => $this->quote?->quote_id,
            'title'         => $this->title,
            'image'         => Quote::fileRef($this->image, 'payment-links'),
            'specs'         => $this->specs,
            'company_name'  => $this->company_name,
            'side_view'     => $this->side_view,
            'contact'       => $this->contact,
            'email'         => $this->email,
            'amount'        => $this->amount,
            'quote_total'   => $this->quote_total,
            'kind'          => $this->kind,
            'url'           => $this->url,
            'status'        => $this->status,
            'paid_at'       => $this->paid_at?->toIso8601String(),
            'created_by'    => $this->creator?->full_name ?? '',
            'created_at'    => $this->created_at?->toIso8601String(),
        ];
    }
}
