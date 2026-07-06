<?php

namespace App\Http\Controllers\Api;

use App\Constants\AppConstants;
use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        // V1 parity: username stored lowercase + trimmed
        $username = strtolower(trim($request->username));
        $user = User::where('username', $username)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            throw ValidationException::withMessages([
                'username' => ['Invalid username or password'],
            ]);
        }

        $user->forceFill(['last_login' => now()])->save();
        ActivityLog::record($user->id, 'login', "{$user->username} logged in");

        $token = $user->createToken('api-token')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user'  => $user->toApi(),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();
        ActivityLog::record($user->id, 'logout', "{$user->username} logged out");
        $user->currentAccessToken()->delete();

        return response()->json(['ok' => true]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $request->user()->toApi()]);
    }

    // V1 GET /api/constants
    public function constants(): JsonResponse
    {
        return response()->json([
            'statuses'      => AppConstants::STATUS_OPTIONS,
            'sales_reps'    => AppConstants::SALES_REPS,
            'quote_sources' => AppConstants::QUOTE_SOURCES,
            'roles'         => AppConstants::ROLES,
            'sign_types'    => AppConstants::SIGN_TYPE_NAMES,
            // everyone on the team — feeds the "Assigned to" dropdown (quotes can be
            // assigned to any user, not just the preset sales reps)
            'team'          => \App\Models\User::orderBy('full_name')->pluck('full_name'),
        ]);
    }
}
