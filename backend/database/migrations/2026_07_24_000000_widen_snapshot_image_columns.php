<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // snapshot_image was varchar(255) — fine for one Cloudinary URL. A multi-sign quote's version
    // history now stores ONE URL PER PAGE (pipe-joined) so the History modal can show a real
    // carousel instead of a stitched composite image; three page URLs alone can pass 255 chars,
    // so this widens both checkpoint and revision snapshot columns to TEXT. Existing single-URL
    // values are untouched — this is a widen-only, non-destructive type change.
    public function up(): void
    {
        Schema::table('quote_checkpoints', function (Blueprint $table) {
            $table->text('snapshot_image')->nullable()->change();
        });
        Schema::table('quote_revisions', function (Blueprint $table) {
            $table->text('snapshot_image')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('quote_checkpoints', function (Blueprint $table) {
            $table->string('snapshot_image')->nullable()->change();
        });
        Schema::table('quote_revisions', function (Blueprint $table) {
            $table->string('snapshot_image')->nullable()->change();
        });
    }
};
