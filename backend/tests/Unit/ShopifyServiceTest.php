<?php

use App\Models\Quote;
use App\Services\ShopifyService;

it('makes a single Full Payment variant at the full price, with NO option tag (#9)', function () {
    $v = ShopifyService::variantsFor(3500.0, 'full');
    expect($v)->toHaveCount(1);
    expect($v[0])->not->toHaveKey('option1');
    expect($v[0]['price'])->toBe('3500.00');
});

it('makes a single 50% Deposit variant at half', function () {
    $v = ShopifyService::variantsFor(3500.0, 'deposit');
    expect($v)->toHaveCount(1);
    expect($v[0])->not->toHaveKey('option1');
    expect($v[0]['price'])->toBe('1750.00');
});

it('makes a single Balance variant at half', function () {
    $v = ShopifyService::variantsFor(3500.0, 'balance');
    expect($v)->toHaveCount(1);
    expect($v[0])->not->toHaveKey('option1');
    expect($v[0]['price'])->toBe('1750.00');
});

it('tracks inventory and makes each variant a one-time purchase (1 in stock, deny)', function () {
    foreach (['full', 'deposit', 'balance'] as $kind) {
        $v = ShopifyService::variantsFor(1000.0, $kind)[0];
        expect($v['inventory_management'])->toBe('shopify');   // tracked
        expect($v['inventory_policy'])->toBe('deny');          // sold out after one purchase
    }
    // the stock is set to 1 at the US location after create; if that fails the controller
    // untracks the variant so it can never become an unpayable "sold out".
});

it('rounds a 50% amount to cents', function () {
    expect(ShopifyService::variantsFor(3499.99, 'deposit')[0]['price'])->toBe('1750.00');
});

it('Title-cases text (first letter of each word, not ALL CAPS)', function () {
    expect(ShopifyService::titleCase('FACE LIT CHANNEL LETTERS FOR SIGNARAMA'))->toBe('Face Lit Channel Letters For Signarama');
});

it('labels the payment kind for the title', function () {
    expect(ShopifyService::kindLabel('full'))->toBe('Full Payment');
    expect(ShopifyService::kindLabel('deposit'))->toBe('50% Deposit');
    expect(ShopifyService::kindLabel('balance'))->toBe('Remaining Balance (50%)');
});

// Each payment link is a Shopify DRAFT-ORDER invoice for its own single variant — a standalone
// checkout with no cart. Cart/product links piled multiple links into one shared cart and billed
// the SUM ("$39,470 instead of one item"); a draft-order invoice holds only its own line item.
// The draft order itself is created via the live API (createDraftOrder), so what's unit-testable
// here is the pricing invariant: each kind is ONE variant at ONE amount, so one link = one charge.
it('gives each payment kind its own single-amount variant so one link bills one amount', function () {
    $full = ShopifyService::variantsFor(6000.0, 'full');
    $dep  = ShopifyService::variantsFor(6000.0, 'deposit');
    expect($full)->toHaveCount(1);
    expect($dep)->toHaveCount(1);
    expect($full[0]['price'])->toBe('6000.00');
    expect($dep[0]['price'])->toBe('3000.00');
});
