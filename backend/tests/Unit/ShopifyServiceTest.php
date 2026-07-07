<?php

use App\Services\ShopifyService;

it('offers Full + 50% Deposit when the total is over $500', function () {
    $v = ShopifyService::variantsFor(3500.0);
    expect($v)->toHaveCount(2);
    expect($v[0]['option1'])->toBe('Full Payment');
    expect($v[0]['price'])->toBe('3500.00');
    expect($v[1]['option1'])->toBe('50% Deposit');
    expect($v[1]['price'])->toBe('1750.00');
});

it('offers ONLY Full Payment when the total is $500 or less', function () {
    $v = ShopifyService::variantsFor(500.0);
    expect($v)->toHaveCount(1);
    expect($v[0]['option1'])->toBe('Full Payment');
    expect($v[0]['price'])->toBe('500.00');
});

it('makes a single Balance variant for the balance link', function () {
    $v = ShopifyService::variantsFor(3500.0, 'balance');
    expect($v)->toHaveCount(1);
    expect($v[0]['option1'])->toBe('Balance (50%)');
    expect($v[0]['price'])->toBe('1750.00');
});

it('keeps every variant always purchasable (never blocked by stock)', function () {
    foreach (ShopifyService::variantsFor(1000.0) as $variant) {
        expect($variant['inventory_policy'])->toBe('continue');
    }
});

it('rounds a 50% deposit to cents', function () {
    // odd total → deposit is exactly half, 2dp
    $v = ShopifyService::variantsFor(3499.99);
    expect($v[1]['option1'])->toBe('50% Deposit');
    expect($v[1]['price'])->toBe('1750.00');   // 3499.99/2 = 1749.995 → 1750.00
});
