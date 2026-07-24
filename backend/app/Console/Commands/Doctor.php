<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * READ-ONLY production triage. Born from "I can't log in and /api/constants returns 500":
 * from outside, a half-migrated database and a wrong password are the same generic error, so
 * there was no way to tell them apart without guessing. This prints the facts that separate
 * them — which tables exist, whether any migration is pending, and who is actually in the
 * users table — without touching a single row or revealing a password hash.
 *
 * Run it on the environment that is failing, not on your laptop: the whole point is that the
 * two have different databases.
 */
class Doctor extends Command
{
    protected $signature = 'app:doctor';

    protected $description = 'Read-only health check: DB connection, tables, pending migrations, users';

    /** Tables the API needs to answer login + /api/constants. */
    // NB: activity_log is SINGULAR (see ActivityLog::$table) — guessing the Laravel-default
    // plural here made this command report a missing table on a perfectly healthy database,
    // which is the exact false alarm it was written to prevent.
    private const CORE_TABLES = [
        'users', 'settings', 'quotes', 'companies', 'activity_log',
        'personal_access_tokens', 'migrations',
    ];

    public function handle(): int
    {
        $this->line('');
        $this->info('── CONNECTION ─────────────────────────────');
        try {
            $name = DB::connection()->getDatabaseName();
            DB::select('select 1');
            $this->line('  driver   : ' . DB::connection()->getDriverName());
            $this->line('  database : ' . $name);
            $this->line('  status   : CONNECTED');
        } catch (\Throwable $e) {
            $this->error('  CANNOT CONNECT: ' . $e->getMessage());
            return self::FAILURE;   // nothing below can be trusted without a connection
        }

        $this->line('');
        $this->info('── CORE TABLES ────────────────────────────');
        $missing = [];
        foreach (self::CORE_TABLES as $t) {
            $ok = Schema::hasTable($t);
            if (!$ok) {
                $missing[] = $t;
            }
            $this->line(sprintf('  %-24s %s', $t, $ok ? 'present' : 'MISSING'));
        }

        $this->line('');
        $this->info('── MIGRATIONS ─────────────────────────────');
        if (!Schema::hasTable('migrations')) {
            $this->error('  migrations table missing — this database has never been migrated.');
        } else {
            $ran = DB::table('migrations')->count();
            $files = glob(database_path('migrations/*.php')) ?: [];
            $this->line('  applied in DB : ' . $ran);
            $this->line('  files in repo : ' . count($files));
            if (count($files) > $ran) {
                $this->warn('  PENDING: ' . (count($files) - $ran) . ' migration(s) not applied here.');
                $this->warn('  Fix with: php artisan migrate --force');
            }
        }

        $this->line('');
        $this->info('── USERS ──────────────────────────────────');
        if (!Schema::hasTable('users')) {
            $this->error('  users table missing — nobody can log in until migrations run.');
        } else {
            // full_name is read by /api/constants and by the login response; a schema that
            // predates it 500s those endpoints while login itself still "works".
            foreach (['username', 'email', 'full_name', 'role', 'password'] as $col) {
                if (!Schema::hasColumn('users', $col)) {
                    $this->error('  users.' . $col . ' COLUMN MISSING');
                }
            }
            $users = DB::table('users')->orderBy('id')->get(['id', 'username', 'email', 'role']);
            $this->line('  count: ' . $users->count());
            foreach ($users as $u) {
                $this->line(sprintf('   %-4s %-22s %-34s %s', $u->id, $u->username, $u->email ?: '(no email)', $u->role ?? ''));
            }
            if ($users->isEmpty()) {
                $this->warn('  No users. Create one with: php artisan app:ensure-admin --username=you');
            }
        }

        $this->line('');
        if ($missing !== []) {
            $this->error('VERDICT: schema incomplete — missing: ' . implode(', ', $missing));
            $this->line('Run: php artisan migrate --force');
            return self::FAILURE;
        }
        $this->info('VERDICT: schema looks complete.');

        return self::SUCCESS;
    }
}
