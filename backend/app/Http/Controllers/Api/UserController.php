<?php

namespace App\Http\Controllers\Api;

use App\Constants\AppConstants;
use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    // V1 parity: all user management is admin-only (enforced via route middleware:role:admin)

    public function index(): JsonResponse
    {
        // V1 orders by username
        $users = User::orderBy('username')->get()->map->toApi();

        return response()->json($users);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username'  => 'required|string|max:80',
            'full_name' => 'nullable|string|max:120',
            'email'     => 'nullable|email|max:120',
            'role'      => ['required', Rule::in(AppConstants::ROLES)],
            'password'  => 'nullable|string',
        ]);

        // V1 parity: username lowercased + trimmed, unique
        $username = strtolower(trim($data['username']));
        if (User::where('username', $username)->exists()) {
            return response()->json(['error' => 'username already exists'], 400);
        }

        $user = User::create([
            'username'  => $username,
            'full_name' => $data['full_name'] ?: $username,
            'email'     => trim($data['email'] ?? ''),
            'role'      => $data['role'],
            // NO Hash::make here: User casts password to 'hashed', which hashes on assignment.
            // Wrapping it again double-hashed every password — Hash::check could never match, so
            // every user created through this endpoint was permanently locked out.
            'password'  => $data['password'] ?? 'changeme123',
        ]);

        ActivityLog::record($request->user()->id, 'user_created', "{$username} ({$user->role})");

        return response()->json($user->toApi(), 201);
    }

    public function show(User $user): JsonResponse
    {
        return response()->json($user->toApi());
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'username'  => 'sometimes|string|max:80',
            'full_name' => 'sometimes|nullable|string|max:120',
            'email'     => 'sometimes|nullable|email|max:120',
            'role'      => ['sometimes', Rule::in(AppConstants::ROLES)],
            'can_create_payment_links' => 'sometimes|boolean',
        ]);

        $changes = [];

        if (array_key_exists('username', $data)) {
            $new = strtolower(trim($data['username']));
            if ($new === '') {
                return response()->json(['error' => 'username is required'], 400);
            }
            if ($new !== $user->username && User::where('username', $new)->exists()) {
                return response()->json(['error' => 'username already exists'], 400);
            }
            if ($new !== $user->username) {
                $changes[] = "username: {$user->username} -> {$new}";
                $user->username = $new;
            }
        }

        if (array_key_exists('role', $data) && $data['role'] !== $user->role) {
            $changes[] = "role: {$user->role} -> {$data['role']}";
            $user->role = $data['role'];
        }

        foreach (['full_name', 'email'] as $field) {
            if (array_key_exists($field, $data) && (string) ($data[$field] ?? '') !== (string) ($user->{$field} ?? '')) {
                $changes[] = $field;
                $user->{$field} = $data[$field] ?? '';
            }
        }

        if (array_key_exists('can_create_payment_links', $data) && (bool) $data['can_create_payment_links'] !== (bool) $user->can_create_payment_links) {
            $user->can_create_payment_links = (bool) $data['can_create_payment_links'];
            $changes[] = $user->can_create_payment_links ? 'granted payment-link creation' : 'revoked payment-link creation';
        }

        $user->save();

        if ($changes) {
            ActivityLog::record($request->user()->id, 'user_updated', "{$user->username}: ".implode(', ', $changes));
        }

        return response()->json($user->fresh()->toApi());
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        // V1 parity: cannot delete own account
        if ($user->id === $request->user()->id) {
            return response()->json(['error' => 'You cannot delete your own account'], 400);
        }

        $username = $user->username;
        // removing a user removes their trail too — they must disappear from the Activity
        // Log and its analytics entirely, not linger as "Unknown" rows
        ActivityLog::where('user_id', $user->id)->delete();
        $user->delete();
        ActivityLog::record($request->user()->id, 'user_deleted', $username);

        return response()->json(['ok' => true]);
    }

    public function changePassword(Request $request, User $user): JsonResponse
    {
        $password = (string) $request->input('password', '');

        // V1 parity: min 4 chars
        if (strlen($password) < 4) {
            return response()->json(['error' => 'Password must be at least 4 characters'], 400);
        }

        // Plain assignment — the model's 'hashed' cast hashes it. Hash::make on top of the cast
        // double-hashed the value ("changed a user's creds and now can't even log in").
        $user->update(['password' => $password]);
        // Revoke tokens so the user must re-authenticate
        $user->tokens()->delete();
        ActivityLog::record($request->user()->id, 'user_password_changed', $user->username);

        return response()->json(['ok' => true]);
    }
}
