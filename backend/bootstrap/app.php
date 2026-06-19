<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api',
        health: '/up',
        then: function () {
            // Serve public-disk uploads (artwork, customer files, logos) directly — no
            // storage:link symlink needed, so it works on Windows and in Docker alike.
            // Flysystem blocks path traversal, so '../' escapes resolve to a 404.
            Route::get('/storage/{path}', function (string $path) {
                $disk = Storage::disk('public');
                abort_unless($disk->exists($path), 404);
                return response()->file($disk->path($path));
            })->where('path', '.*');
        },
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'role' => \App\Http\Middleware\RoleMiddleware::class,
        ]);

        // Pure Bearer-token auth (#130) — NOT cookie/CSRF SPA mode.
        // statefulApi() would force CSRF on requests from SANCTUM_STATEFUL_DOMAINS
        // (e.g. the vite dev origin), causing 419 on token logins.
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->render(function (\Illuminate\Auth\AuthenticationException $e, Request $request) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        });

        $exceptions->render(function (\Illuminate\Auth\Access\AuthorizationException $e, Request $request) {
            return response()->json(['message' => 'Forbidden.'], 403);
        });

        $exceptions->render(function (\Illuminate\Validation\ValidationException $e, Request $request) {
            return response()->json([
                'message' => 'Validation failed.',
                'errors'  => $e->errors(),
            ], 422);
        });

        $exceptions->render(function (\Symfony\Component\HttpKernel\Exception\NotFoundHttpException $e, Request $request) {
            return response()->json(['message' => 'Not found.'], 404);
        });
    })->create();
