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

// A payment link must be a CART PERMALINK for its own single variant — never a product page.
// Product-page links share the customer's cart, so multiple deposit links accumulated and billed
// the SUM ("$18k instead of $6k"). A /cart/{variant}:1 permalink empties the cart and bills one.
it('builds a cart permalink that isolates each link to its own variant', function () {
    $url = ShopifyService::checkoutUrl('epiccraftings.com', '44551234567890');
    expect($url)->toBe('https://epiccraftings.com/cart/44551234567890:1');
    expect($url)->not->toContain('/products/');   // product pages accumulate — must not be used
});

it('gives each payment kind its own variant so one link bills one amount', function () {
    // full and deposit are DIFFERENT single-variant products; each cart permalink checks out only
    // its own variant, so opening several links can never sum them.
    $full = ShopifyService::variantsFor(6000.0, 'full')[0]['price'];
    $dep  = ShopifyService::variantsFor(6000.0, 'deposit')[0]['price'];
    expect($full)->toBe('6000.00');
    expect($dep)->toBe('3000.00');
    expect(ShopifyService::variantsFor(6000.0, 'full'))->toHaveCount(1);
});
