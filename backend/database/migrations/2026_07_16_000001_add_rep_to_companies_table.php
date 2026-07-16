<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The account manager (Rod Muffet / ED) who owns this company. Populated from the team's Airtable
// Account-Manager data via `companies:assign-reps`, and used to pre-pick the rep at quote intake.
// Nullable: a company we've never seen a rep tag for stays blank (intake leaves the rep empty).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            $table->string('rep')->nullable()->after('email');
        });
    }

    public function down(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            $table->dropColumn('rep');
        });
    }
};
