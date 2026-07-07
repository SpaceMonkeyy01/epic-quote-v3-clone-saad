<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Private ledger of every Shopify payment link we generate (#Shopify). One row per link so
// the team can uniquely identify any link later by the quote details it was made from, and
// see whether it has been paid. This is OURS — independent of Shopify — and is the record
// that ends the "which link was this?" time-drain.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('quote_id')->constrained()->cascadeOnDelete();

            // identifying snapshot (frozen at creation — the quote can change later)
            $table->string('title');                 // "{Quote ID} - {Item Description}"
            $table->string('image')->nullable();     // clean preview PNG (no price block)
            $table->text('specs')->nullable();       // proposal spec text
            $table->string('company_name')->nullable();
            $table->string('side_view')->nullable(); // chosen dimensions/side-view ref
            $table->string('contact')->nullable();   // phone the link was sent to
            $table->string('email')->nullable();     // email the link was sent to

            // money + kind
            $table->decimal('amount', 12, 2);        // what THIS link charges
            $table->decimal('quote_total', 12, 2)->nullable();  // the quote's full price at creation
            $table->enum('kind', ['deposit', 'balance', 'full'])->default('full');

            // Shopify handles (null until the link is actually created against Shopify)
            $table->string('shopify_product_id')->nullable();
            $table->string('shopify_variant_id')->nullable();
            $table->string('url')->nullable();       // the product-page link we send

            // lifecycle
            $table->enum('status', ['unpaid', 'paid', 'void'])->default('unpaid');
            $table->timestamp('paid_at')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['quote_id', 'kind']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_links');
    }
};
