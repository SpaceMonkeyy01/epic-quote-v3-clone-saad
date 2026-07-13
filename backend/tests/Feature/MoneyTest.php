<?php

/* Money-path invariants: quote.price is the GRAND TOTAL (unit x qty + line items),
   clamped by the sanity cap, and payment links refuse to go out in illegal states.
   These paths bill real customers — every change here needs a test. */

use App\Http\Controllers\Api\QuoteController;
use Laravel\Sanctum\Sanctum;

it('computes quote.price as unit x qty plus line items on generated save', function () {
    login(makeUser(['role' => 'admin']));
    $quote = makeQuote();

    $this->putJson("/api/quotes/{$quote->quote_id}/generated", [
        'quote_type'  => 'custom',
        'custom_spec' => ['price' => 100, 'qty' => 3, 'specText' => 'SIGN TYPE: TEST'],
        'proposal_state' => ['__qty' => 3, '__items' => [['desc' => 'extra', 'qty' => 2, 'unit' => 50]]],
    ])->assertOk();

    // 100 x 3 + 2 x 50 = 400
    expect((float) $quote->fresh()->price)->toBe(400.0);
});

it('clamps quote.price at the sanity cap', function () {
    login(makeUser(['role' => 'admin']));
    $quote = makeQuote();

    $this->putJson("/api/quotes/{$quote->quote_id}/generated", [
        'custom_spec' => ['price' => 900000, 'qty' => 5],
        'proposal_state' => ['__qty' => 5],
    ])->assertOk();

    expect((float) $quote->fresh()->price)->toBe((float) QuoteController::MAX_QUOTE_PRICE);
});

it('sums every part into the grand total for a multi-sign quote', function () {
    login(makeUser(['role' => 'admin']));
    $quote = makeQuote();

    // part A: 1000 x 2 = 2000; part B: 500 x 1 + one extra line (3 x 100 = 300) = 800; grand = 2800
    $this->putJson("/api/quotes/{$quote->quote_id}/generated", [
        'quote_type' => 'custom',
        'parts' => [
            ['custom_spec' => ['price' => 1000, 'qty' => 2], 'proposal_state' => ['__qty' => 2]],
            ['custom_spec' => ['price' => 500,  'qty' => 1], 'proposal_state' => ['__qty' => 1, '__items' => [['qty' => 3, 'unit' => 100]]]],
        ],
    ])->assertOk();

    expect((float) $quote->fresh()->price)->toBe(2800.0);
});

it('accepts six-figure prices (the 20k cap is gone)', function () {
    login(makeUser(['role' => 'admin']));
    $quote = makeQuote();

    $this->putJson("/api/quotes/{$quote->quote_id}/generated", [
        'custom_spec' => ['price' => 250000, 'qty' => 1],
    ])->assertOk();

    expect((float) $quote->fresh()->price)->toBe(250000.0);
});

it('refuses a payment link while the quote is locked and unapproved', function () {
    login(makeUser(['role' => 'admin']));
    $quote = makeQuote(['price' => 5000, 'approval_locked' => true, 'price_approved' => false]);

    $this->postJson("/api/quotes/{$quote->quote_id}/payment-link", ['kind' => 'full'])
        ->assertStatus(422);
});

it('refuses a payment link when no price is set', function () {
    login(makeUser(['role' => 'admin']));
    $quote = makeQuote(['price' => 0]);

    $this->postJson("/api/quotes/{$quote->quote_id}/payment-link", ['kind' => 'full'])
        ->assertStatus(422);
});

it('forces full payment for quotes of 500 or less', function () {
    login(makeUser(['role' => 'admin']));
    $quote = makeQuote(['price' => 400]);

    $this->postJson("/api/quotes/{$quote->quote_id}/payment-link", ['kind' => 'deposit'])
        ->assertStatus(422);
});
