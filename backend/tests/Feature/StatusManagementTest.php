<?php

/* Admin-managed quote statuses (#16): only admins may edit the list, "Done" is protected
   (reports key off it), and the effective list drives the constants endpoint + status
   validation everywhere. */

use App\Models\Setting;

it('rejects status management for non-admins', function () {
    login(makeUser());
    $this->putJson('/api/settings/statuses', ['statuses' => ['To Do', 'Done']])
        ->assertStatus(403);
});

it('rejects removing Done from the list', function () {
    login(makeUser(['role' => 'admin']));
    $this->putJson('/api/settings/statuses', ['statuses' => ['To Do', 'In Progress']])
        ->assertStatus(422);
});

it('saves the admin list and serves it from constants', function () {
    login(makeUser(['role' => 'admin']));
    $this->putJson('/api/settings/statuses', ['statuses' => ['To Do', 'Waiting on Art', 'Done']])
        ->assertOk();

    expect(Setting::statusOptions())->toBe(['To Do', 'Waiting on Art', 'Done']);
    $this->getJson('/api/constants')->assertOk()
        ->assertJsonPath('statuses', ['To Do', 'Waiting on Art', 'Done']);
});

it('validates quote status changes against the ADMIN list, not the defaults', function () {
    login(makeUser(['role' => 'admin']));
    Setting::put('status_options', json_encode(['To Do', 'Waiting on Art', 'Done']));
    $quote = makeQuote();

    // a custom status from the admin list is accepted…
    $this->putJson("/api/quotes/{$quote->quote_id}/status", ['status' => 'Waiting on Art'])->assertOk();
    // …and a removed default is rejected
    $this->putJson("/api/quotes/{$quote->quote_id}/status", ['status' => 'In Progress'])->assertStatus(400);
});
