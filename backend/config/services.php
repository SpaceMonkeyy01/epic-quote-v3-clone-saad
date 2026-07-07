<?php

return [
    'groq' => [
        'key'          => env('GROQ_API_KEY'),
        'model'        => env('GROQ_MODEL', 'llama-3.3-70b-versatile'),
        'vision_model' => env('GROQ_VISION_MODEL', 'meta-llama/llama-4-scout-17b-16e-instruct'),
    ],
    'shopify' => [
        'domain'  => env('SHOPIFY_STORE_DOMAIN'),   // xxx.myshopify.com
        'token'   => env('SHOPIFY_API_TOKEN'),       // Admin API access token (Render secret, never committed)
        'version' => env('SHOPIFY_API_VERSION', '2025-01'),
        'location_id' => env('SHOPIFY_LOCATION_ID'), // US warehouse (optional)
        'webhook_secret' => env('SHOPIFY_WEBHOOK_SECRET'), // verifies orders/paid webhooks
    ],

];
