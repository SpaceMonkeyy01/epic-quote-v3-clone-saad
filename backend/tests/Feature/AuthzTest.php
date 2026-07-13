<?php

/* Authorization invariants: quote visibility scoping, admin-only destruction, and the
   cross-parent guard on restore. A hole here shows one rep another rep's customers. */

use App\Models\QuoteCheckpoint;
use Laravel\Sanctum\Sanctum;

it('hides another rep\'s quote (show + revisions)', function () {
    $owner = makeUser();
    $other = makeUser();
    $quote = makeQuote(['sales_rep' => $owner->full_name, 'assigned_to' => $owner->full_name]);

    login($other);
    $this->getJson("/api/quotes/{$quote->quote_id}")->assertStatus(403);
    $this->getJson("/api/quotes/{$quote->quote_id}/revisions")->assertStatus(403);
});

it('shows a repless (shared) quote to everyone', function () {
    login(makeUser());
    $quote = makeQuote(['sales_rep' => '']);

    $this->getJson("/api/quotes/{$quote->quote_id}")->assertOk();
});

// one login per test — the sanctum guard caches the first authenticated user for the
// lifetime of the test app, so a second login() inside the same test silently no-ops
it('blocks quote deletion for ordinary reps', function () {
    $quote = makeQuote(['sales_rep' => '']);
    login(makeUser());
    $this->deleteJson("/api/quotes/{$quote->quote_id}")->assertStatus(403);
});

it('allows quote deletion for admins', function () {
    $quote = makeQuote(['sales_rep' => '']);
    login(makeUser(['role' => 'admin']));
    $this->deleteJson("/api/quotes/{$quote->quote_id}")->assertOk();
});

it('404s a restore that targets a checkpoint of a DIFFERENT quote', function () {
    login(makeUser(['role' => 'admin']));
    $a = makeQuote();
    $b = makeQuote();
    $cp = QuoteCheckpoint::create([
        'quote_id' => $a->id, 'seq' => 1, 'label' => $a->quote_id.'-rev1',
        'trigger' => 'manual', 'created_at' => now(),
    ]);

    // checkpoint belongs to A — restoring it "via" B must be a 404, never a data write
    $this->postJson("/api/quotes/{$b->quote_id}/checkpoints/{$cp->id}/restore")
        ->assertStatus(404);
});

it('blocks a restore on a quote the user cannot see', function () {
    $owner = makeUser();
    $quote = makeQuote(['sales_rep' => $owner->full_name, 'assigned_to' => $owner->full_name]);
    $cp = QuoteCheckpoint::create([
        'quote_id' => $quote->id, 'seq' => 1, 'label' => $quote->quote_id.'-rev1',
        'trigger' => 'manual', 'created_at' => now(),
    ]);

    login(makeUser());   // stranger
    $this->postJson("/api/quotes/{$quote->quote_id}/checkpoints/{$cp->id}/restore")
        ->assertStatus(403);
});
