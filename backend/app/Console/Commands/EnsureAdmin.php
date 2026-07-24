<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;

/**
 * Create-or-repair one admin login, idempotently (Rule L5-7: data changes ship as idempotent,
 * dry-runnable artisan commands that report counts).
 *
 * Why this exists: production and local are DIFFERENT databases, so an account that works on a
 * laptop can be absent — or hold an older password — on the deployed environment, and the only
 * symptom is the same "Login failed." the UI shows for a typo. Resetting by hand meant a raw
 * bcrypt UPDATE, which is exactly the kind of thing that gets a hash wrong and burns an evening.
 *
 * The password is PROMPTED, never passed as a flag: an argument would be recorded in the shell
 * history and in Render's command log. Nothing here echoes the password or its hash back.
 */
class EnsureAdmin extends Command
{
    protected $signature = 'app:ensure-admin
        {--username= : Login username (lowercased; this is what the rep types)}
        {--email= : Email address, also accepted at the login prompt}
        {--name= : Full name shown in the UI}
        {--role=admin : Role to grant}
        {--dry-run : Report what WOULD change and exit without writing}';

    protected $description = 'Create or repair an admin user (idempotent; prompts for the password)';

    public function handle(): int
    {
        $username = strtolower(trim((string) ($this->option('username') ?: $this->ask('Username'))));
        if ($username === '') {
            $this->error('A username is required.');
            return self::FAILURE;
        }

        $email = trim((string) ($this->option('email') ?? ''));
        $dry   = (bool) $this->option('dry-run');

        // Match the CONTROLLER's lookup exactly — username first, then case-insensitive email —
        // so this command can never "fix" a different row than the one login resolves to.
        $user = User::where('username', $username)->first()
            ?? ($email !== '' ? User::whereRaw('LOWER(email) = ?', [strtolower($email)])->orderBy('id')->first() : null);

        $existed = (bool) $user;
        $this->line($existed
            ? "Found existing user id={$user->id} (username={$user->username})"
            : "No user matches '{$username}' — it will be CREATED.");

        if ($dry) {
            $this->warn('--dry-run: nothing written.');
            $this->line('  would ' . ($existed ? 'update' : 'create') . ": username={$username}"
                . ($email !== '' ? ", email={$email}" : '') . ', role=' . $this->option('role'));
            return self::SUCCESS;
        }

        // secret() disables terminal echo — the password is not shown and not stored in history.
        $pw = $this->secret('New password (input hidden)');
        if (strlen((string) $pw) < 8) {
            $this->error('Password must be at least 8 characters. Nothing was changed.');
            return self::FAILURE;
        }
        if ($pw !== $this->secret('Confirm password')) {
            $this->error('Passwords did not match. Nothing was changed.');
            return self::FAILURE;
        }

        $user ??= new User();
        $user->username = $username;
        if ($email !== '') {
            $user->email = $email;
        }
        if ($this->option('name')) {
            $user->full_name = $this->option('name');
        }
        $user->full_name ??= ucfirst($username);   // full_name is NOT NULL and is read by /api/constants
        $user->role = $this->option('role');
        $user->password = Hash::make($pw);
        $user->save();

        $this->info(($existed ? 'UPDATED' : 'CREATED') . " user id={$user->id} username={$user->username} role={$user->role}");
        $this->line('Verifying the stored hash accepts that password...');
        $this->line(Hash::check($pw, $user->fresh()->password) ? '  OK — this account can now log in.' : '  FAILED — hash mismatch, do not trust this account.');

        return self::SUCCESS;
    }
}
