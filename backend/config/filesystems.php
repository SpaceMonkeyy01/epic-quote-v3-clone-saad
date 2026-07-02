<?php

return [
    'default' => env('FILESYSTEM_DISK', 'local'),

    'disks' => [
        'local' => [
            'driver' => 'local',
            'root'   => storage_path('app/private'),
            // false — Laravel 12's built-in serve registers its own GET /storage/{path}
            // route that SHADOWS our custom one in bootstrap/app.php (which adds the CORS
            // headers the SPA needs, on both hit and miss). Ours must win.
            'serve'  => false,
            'throw'  => false,
        ],

        'public' => [
            'driver'     => 'local',
            // On Render, point this at the persistent disk (PUBLIC_DISK_ROOT=/var/data/public)
            // so uploads survive redeploys; unset locally → default ephemeral-safe path.
            'root'       => env('PUBLIC_DISK_ROOT', storage_path('app/public')),
            'url'        => env('APP_URL').'/storage',
            'visibility' => 'public',
            'throw'      => false,
        ],

        's3' => [
            'driver'                  => 's3',
            'key'                     => env('AWS_ACCESS_KEY_ID'),
            'secret'                  => env('AWS_SECRET_ACCESS_KEY'),
            'region'                  => env('AWS_DEFAULT_REGION'),
            'bucket'                  => env('AWS_BUCKET'),
            'url'                     => env('AWS_URL'),
            'endpoint'                => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw'                   => false,
        ],
    ],

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],
];
