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

    // A multi-sign quote's snapshot is one URL PER PAGE, newline-joined in the single
    // snapshot_image column (see QuoteController::storeSnapshotImages) — split it back into an
    // array here so the frontend never has to know about the storage encoding. snapshot_image
    // stays as the FIRST page for any old code path that only ever expected one URL.
    public function snapshotImages(): array
    {
        $raw = (string) $this->snapshot_image;
        return $raw === '' ? [] : array_values(array_filter(explode("\n", $raw), fn ($u) => $u !== ''));
    }

    public function toApi(array $changes = []): array
    {
        $images = $this->snapshotImages();
        return [
            'id'              => $this->id,
            'seq'             => $this->seq,
            'label'           => $this->label,
            'trigger'         => $this->trigger,
            'snapshot_image'  => $images[0] ?? null,
            'snapshot_images' => $images,
            'user_name'       => $this->user_name ?: 'System',
            'created_at'      => optional($this->created_at)->toIso8601String(),
            'changes'         => $changes,
        ];
    }
}
