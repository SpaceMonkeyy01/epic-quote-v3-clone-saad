<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A checkpoint = a named version ({quote_id}-rev{seq}) minted when a payment is created
        // (or manually). It groups every change recorded since the previous checkpoint, and holds
        // one rendered proposal image for that version.
        Schema::create('quote_checkpoints', function (Blueprint $table) {
            $table->id();
            $table->foreignId('quote_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('seq');                 // 1,2,3… per quote → rev1, rev2…
            $table->string('label');                        // "{quote_id}-rev{seq}"
            $table->string('trigger')->default('payment');  // payment | manual
            $table->string('snapshot_image')->nullable();   // proposal image at this version
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('user_name')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->unique(['quote_id', 'seq']);
            $table->index('quote_id');
        });

        // Each revision belongs to at most one checkpoint. NULL = recorded but not yet checkpointed
        // (edits made after the last payment) — shown under a "Current" group in the history.
        Schema::table('quote_revisions', function (Blueprint $table) {
            $table->foreignId('checkpoint_id')->nullable()->after('quote_id')
                ->constrained('quote_checkpoints')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('quote_revisions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('checkpoint_id');
        });
        Schema::dropIfExists('quote_checkpoints');
    }
};
