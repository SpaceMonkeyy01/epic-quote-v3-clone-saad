<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Team-added catalog entries (custom sign types with their spec templates, uploaded
// side views) — shared by every user and by BOTH quote modes (AI + manual).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_catalog_items', function (Blueprint $table) {
            $table->id();
            $table->string('kind', 24)->index();     // 'sign_type' | 'side_view'
            $table->string('name', 160);
            $table->json('data')->nullable();        // sign_type: {spec}; side_view: {path}
            $table->timestamps();
            $table->unique(['kind', 'name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_catalog_items');
    }
};
