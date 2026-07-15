<?php

use Illuminate\Support\Facades\Route;

// Health check (unauthenticated)
Route::get('/health', fn() => response()->json(['status' => 'ok', 'version' => 'v3']));

// Auth
Route::post('/login', [App\Http\Controllers\Api\AuthController::class, 'login'])->middleware('throttle:6,1');
Route::post('/logout', [App\Http\Controllers\Api\AuthController::class, 'logout'])->middleware('auth:sanctum');
Route::get('/me', [App\Http\Controllers\Api\AuthController::class, 'me'])->middleware('auth:sanctum');

// Shopify webhook — public (Shopify has no bearer token) but HMAC-verified inside the controller
Route::post('/shopify/webhook/orders-paid', [App\Http\Controllers\Api\ShopifyWebhookController::class, 'ordersPaid']);

// Protected routes
Route::middleware(['auth:sanctum', 'readonly.guard'])->group(function () {
    Route::get('/constants', [App\Http\Controllers\Api\AuthController::class, 'constants']);

    // Users (admin only — V1 parity)
    Route::middleware('role:admin')->group(function () {
        Route::apiResource('users', App\Http\Controllers\Api\UserController::class);
        Route::put('users/{user}/password', [App\Http\Controllers\Api\UserController::class, 'changePassword']);
    });

    // Team catalog: custom sign types + uploaded side views, shared by both quote modes
    Route::get('catalog', [App\Http\Controllers\Api\CatalogController::class, 'index']);
    Route::post('catalog', [App\Http\Controllers\Api\CatalogController::class, 'store']);
    Route::post('catalog/upload', [App\Http\Controllers\Api\CatalogController::class, 'upload']);
    Route::delete('catalog/{item}', [App\Http\Controllers\Api\CatalogController::class, 'destroy']);

    // Quotes
    Route::get('companies/suggest', [App\Http\Controllers\Api\QuoteController::class, 'companySuggest']);
    Route::apiResource('quotes', App\Http\Controllers\Api\QuoteController::class);
    Route::put('quotes/{quote}/status', [App\Http\Controllers\Api\QuoteController::class, 'updateStatus']);
    Route::put('quotes/{quote}/tags', [App\Http\Controllers\Api\QuoteController::class, 'updateTags']);
    Route::post('quotes/{quote}/pdf', [App\Http\Controllers\Api\QuoteController::class, 'uploadPdf']);
    Route::post('quotes/{quote}/extra-file', [App\Http\Controllers\Api\QuoteController::class, 'uploadExtraFile']);
    Route::post('quotes/{quote}/artwork', [App\Http\Controllers\Api\QuoteController::class, 'uploadArtwork']);
    Route::post('quotes/{quote}/crunched-artwork', [App\Http\Controllers\Api\QuoteController::class, 'uploadCrunchedArtwork']);
    Route::get('quotes/{quote}/generated', [App\Http\Controllers\Api\QuoteController::class, 'getGenerated']);
    Route::get('quotes/{quote}/artworks', [App\Http\Controllers\Api\QuoteController::class, 'artworks']);
    Route::put('quotes/{quote}/generated', [App\Http\Controllers\Api\QuoteController::class, 'putGenerated']);
    Route::get('quotes/{quote}/revisions', [App\Http\Controllers\Api\QuoteController::class, 'revisions']);
    Route::post('quotes/{quote}/revisions/snapshot-image', [App\Http\Controllers\Api\QuoteController::class, 'snapshotImage']);
    Route::post('quotes/{quote}/checkpoints', [App\Http\Controllers\Api\QuoteController::class, 'createCheckpoint']);
    Route::post('quotes/{quote}/checkpoints/{checkpoint}/image', [App\Http\Controllers\Api\QuoteController::class, 'attachCheckpointImage']);
    Route::post('quotes/{quote}/checkpoints/{checkpoint}/restore', [App\Http\Controllers\Api\QuoteController::class, 'restoreCheckpoint']);
    Route::get('revisions/feed', [App\Http\Controllers\Api\QuoteController::class, 'activityFeed']);
    // (payment-link / confirm-order / pdf-download routes removed — they were never
    //  implemented (501) and had no callers; order state is set via the normal quote
    //  update and PDF export is client-side print.)

    // Companies / CRM — deferred to A8 (CompanyController not built yet; no frontend caller).
    // Re-enable when the CRM page + CompanyController land, to restore V1 parity.
    // Route::apiResource('companies', App\Http\Controllers\Api\CompanyController::class);
    // Route::post('companies/{company}/representatives', [App\Http\Controllers\Api\CompanyController::class, 'addRepresentative']);
    // Route::put('representatives/{representative}', [App\Http\Controllers\Api\CompanyController::class, 'updateRepresentative']);
    // Route::delete('representatives/{representative}', [App\Http\Controllers\Api\CompanyController::class, 'deleteRepresentative']);

    // AI
    Route::post('/ai/generate-specs', [App\Http\Controllers\Api\AiController::class, 'generateSpecs']);
    Route::post('/ai/extract-party', [App\Http\Controllers\Api\AiController::class, 'extractParty']);

    // Payment links (Shopify) — private ledger + create
    Route::post('quotes/{quote}/payment-link', [App\Http\Controllers\Api\PaymentLinkController::class, 'store']);
    Route::get('shopify/status', [App\Http\Controllers\Api\PaymentLinkController::class, 'shopifyStatus']);
    Route::get('payment-links', [App\Http\Controllers\Api\PaymentLinkController::class, 'index']);
    Route::put('payment-links/{paymentLink}/status', [App\Http\Controllers\Api\PaymentLinkController::class, 'updateStatus']);

    // Dashboard & Reports
    Route::get('/dashboard', [App\Http\Controllers\Api\DashboardController::class, 'index']);
    Route::get('/reports/sales-reps', [App\Http\Controllers\Api\DashboardController::class, 'salesReps']);
    Route::get('/reports/monthly', [App\Http\Controllers\Api\DashboardController::class, 'monthly']);
    Route::get('/reports/funnel', [App\Http\Controllers\Api\DashboardController::class, 'funnel']);
    Route::get('/team', [App\Http\Controllers\Api\DashboardController::class, 'team']);
    Route::get('/activity', [App\Http\Controllers\Api\DashboardController::class, 'activity']);

    // Settings
    Route::get('/settings/logo', [App\Http\Controllers\Api\SettingsController::class, 'getLogo']);
    Route::put('/settings/statuses', [App\Http\Controllers\Api\SettingsController::class, 'setStatuses']);
    Route::post('/settings/logo', [App\Http\Controllers\Api\SettingsController::class, 'setLogo']);
    Route::get('/side-views', [App\Http\Controllers\Api\SettingsController::class, 'sideViews']);
});
