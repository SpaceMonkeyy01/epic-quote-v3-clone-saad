<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuoteCheckpoint extends Model
{
    public $timestamps = false;   // only created_at, set by the service

    protected $fillable = ['quote_id', 'seq', 'label', 'trigger', 'snapshot_image', 'user_id', 'user_name', 'created_at'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public function quote()
    {
        return $this->belongsTo(Quote::class);
    }

    public function revisions()
    {
        return $this->hasMany(QuoteRevision::class, 'checkpoint_id');
    }

    public function toApi(array $changes = []): array
    {
        return [
            'id'             => $this->id,
            'seq'            => $this->seq,
            'label'          => $this->label,
            'trigger'        => $this->trigger,
            'snapshot_image' => $this->snapshot_image,
            'user_name'      => $this->user_name ?: 'System',
            'created_at'     => optional($this->created_at)->toIso8601String(),
            'changes'        => $changes,
        ];
    }
}
