<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuoteRevision extends Model
{
    public $timestamps = false;   // only created_at, managed by the recorder

    protected $fillable = ['quote_id', 'checkpoint_id', 'user_id', 'user_name', 'field_changes', 'snapshot', 'snapshot_image', 'created_at'];

    protected function casts(): array
    {
        return [
            'field_changes' => 'array',
            'snapshot'      => 'array',
            'created_at'    => 'datetime',
        ];
    }

    public function quote()
    {
        return $this->belongsTo(Quote::class);
    }

    // trimmed shape for the history API (snapshot is large — only sent when a single revision is fetched)
    public function toApi(bool $withSnapshot = false): array
    {
        $data = [
            'id'             => $this->id,
            'user_name'      => $this->user_name ?: 'System',
            'changes'        => $this->field_changes ?: [],
            'snapshot_image' => $this->snapshot_image,   // rendered proposal image at this version (may be null)
            'created_at'     => optional($this->created_at)->toIso8601String(),
        ];
        if ($withSnapshot) {
            $data['snapshot'] = $this->snapshot;
        }
        return $data;
    }
}
