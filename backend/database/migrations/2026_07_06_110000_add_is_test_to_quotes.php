<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Test-quote flag (Airtable's "Test Quote" status done right): a test quote stays visible
// and editable but is excluded from EVERY number — dashboard KPIs, pipeline, reports.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('quotes', function (Blueprint $table) {
            $table->boolean('is_test')->default(false)->index();
        });
    }

    public function down(): void
    {
        Schema::table('quotes', function (Blueprint $table) {
            $table->dropColumn('is_test');
        });
    }
};
