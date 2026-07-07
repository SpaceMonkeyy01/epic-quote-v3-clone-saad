<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Contact is split (#22): `contact` becomes the phone number (digits only), and a
// separate `email` column holds the email (letters allowed). Existing contact values
// (all phone numbers in this data) are left as-is.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('quotes', function (Blueprint $table) {
            $table->string('email')->nullable()->after('contact');
        });
    }

    public function down(): void
    {
        Schema::table('quotes', function (Blueprint $table) {
            $table->dropColumn('email');
        });
    }
};
