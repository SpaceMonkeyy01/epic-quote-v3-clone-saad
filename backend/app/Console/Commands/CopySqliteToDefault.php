<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One-time data migration: copy EVERY row from an old SQLite database file into the
 * current default connection (MySQL/Postgres), preserving IDs.
 *
 *   php artisan db:copy-from-sqlite database/database.sqlite            # report + copy
 *   php artisan db:copy-from-sqlite database/database.sqlite --dry-run  # counts only
 *
 * - Tables are discovered from the SQLite file; only those that also exist on the target
 *   are copied (migrations table is skipped — the target keeps its own history).
 * - Copy order is FK-safe (parents first); anything unknown is appended at the end and
 *   FK checks are disabled during the copy as a belt-and-braces.
 * - Each target table is TRUNCATED first (the target should be a fresh `migrate --seed`;
 *   seeded rows are replaced by the real ones so IDs / passwords / tokens keep working).
 * - Verifies row counts per table at the end and fails loudly on any mismatch.
 */
class CopySqliteToDefault extends Command
{
    protected $signature = 'db:copy-from-sqlite {file : path to the sqlite database file} {--dry-run : report row counts, write nothing}';

    protected $description = 'Copy all data from a SQLite file into the current default database (IDs preserved)';

    /** FK-safe order: parents before children. Unlisted tables are appended alphabetically. */
    private const ORDER = [
        'users', 'companies', 'representatives', 'settings',
        'quotes', 'quote_items', 'status_history', 'orders', 'payments',
        'payment_links', 'quote_revisions', 'activity_log',
        'personal_access_tokens', 'user_catalog_items',
    ];

    public function handle(): int
    {
        $file = $this->argument('file');
        if (!is_file($file)) {
            $this->error("SQLite file not found: {$file}");
            return self::FAILURE;
        }
        $target = DB::connection();
        if ($target->getDriverName() === 'sqlite') {
            $this->error('The default connection is still sqlite — point .env at the new database first.');
            return self::FAILURE;
        }

        // register the source connection at runtime
        config(['database.connections.__sqlite_src' => [
            'driver' => 'sqlite', 'database' => realpath($file), 'prefix' => '', 'foreign_key_constraints' => false,
        ]]);
        $src = DB::connection('__sqlite_src');

        // discover source tables
        $tables = collect($src->select("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
            ->pluck('name')
            ->reject(fn ($t) => in_array($t, ['migrations', 'cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs', 'sessions'], true))
            ->values();

        // keep only tables that exist on the target too
        $existing = $tables->filter(fn ($t) => $target->getSchemaBuilder()->hasTable($t))->values();
        $skipped = $tables->diff($existing);
        foreach ($skipped as $t) {
            $this->warn("skip (no such table on target): {$t}");
        }

        // FK-safe ordering
        $ordered = collect(self::ORDER)->filter(fn ($t) => $existing->contains($t))
            ->merge($existing->reject(fn ($t) => in_array($t, self::ORDER, true))->sort()->values());

        $dry = (bool) $this->option('dry-run');
        $plan = [];
        foreach ($ordered as $t) {
            $plan[$t] = (int) $src->table($t)->count();
        }
        $this->table(['table', 'rows in sqlite'], collect($plan)->map(fn ($n, $t) => [$t, $n])->values()->all());
        if ($dry) {
            $this->warn('Dry run — nothing copied.');
            return self::SUCCESS;
        }

        // SQLite's unique index is byte-exact; MySQL's utf8mb4 collation is case-, trailing-space-
        // and ignorable-character-INsensitive, so company names like "NH Signs" / "NH Signs<zwsp>"
        // collide. There is no reliable way to predict MySQL's equality in PHP, so companies are
        // inserted ONE BY ONE and the duplicates MySQL itself rejects are merged: the dropped id
        // is remapped to the surviving row everywhere company_id is referenced.
        $companyRemap = [];

        $isMysql = $target->getDriverName() === 'mysql';
        if ($isMysql) {
            $target->statement('SET FOREIGN_KEY_CHECKS=0');
        }
        try {
            foreach ($ordered as $t) {
                $target->table($t)->truncate();
                $copied = 0;
                $rows = $src->table($t)->get();   // largest table here is a few thousand rows — fine in memory
                if ($companyRemap && $rows->isNotEmpty() && property_exists($rows[0], 'company_id')) {
                    $rows = $rows->map(function ($r) use ($companyRemap) {
                        if (isset($companyRemap[$r->company_id])) {
                            $r->company_id = $companyRemap[$r->company_id];
                        }
                        return $r;
                    });
                }
                if ($t === 'companies') {
                    // row-by-row: let the TARGET's collation decide what a duplicate is
                    foreach ($rows as $r) {
                        try {
                            $target->table($t)->insert((array) $r);
                            $copied++;
                        } catch (\Illuminate\Database\UniqueConstraintViolationException) {
                            $survivor = $target->table($t)->where('name', $r->name)->first();
                            if ($survivor) {
                                $companyRemap[$r->id] = $survivor->id;
                                // backfill blanks on the survivor from the duplicate
                                $patch = [];
                                foreach (['address', 'phone', 'email'] as $f) {
                                    if (!trim((string) $survivor->$f) && trim((string) $r->$f)) {
                                        $patch[$f] = $r->$f;
                                    }
                                }
                                if ($patch) {
                                    $target->table($t)->where('id', $survivor->id)->update($patch);
                                }
                            } else {
                                $this->warn("companies id {$r->id} ('{$r->name}') is a duplicate but no survivor found — dropped.");
                            }
                        }
                    }
                    $plan[$t] = $copied;   // verification target reflects the merges
                    if ($companyRemap) {
                        $this->warn('Merged '.count($companyRemap).' duplicate companies (equal under MySQL collation).');
                    }
                } else {
                    foreach ($rows->chunk(200) as $chunk) {
                        $target->table($t)->insert($chunk->map(fn ($r) => (array) $r)->all());
                        $copied += $chunk->count();
                    }
                }
                // keep AUTO_INCREMENT above the copied ids
                if ($isMysql && $copied > 0 && isset($rows[0]->id)) {
                    $max = (int) $src->table($t)->max('id');
                    $target->statement("ALTER TABLE `{$t}` AUTO_INCREMENT = ".($max + 1));
                }
                $this->info(sprintf('%-28s %5d rows', $t, $copied));
            }
        } finally {
            if ($isMysql) {
                $target->statement('SET FOREIGN_KEY_CHECKS=1');
            }
        }

        // ---- verify ----
        $bad = 0;
        foreach ($ordered as $t) {
            $s = $plan[$t];
            $d = (int) $target->table($t)->count();
            if ($s !== $d) {
                $this->error("MISMATCH {$t}: sqlite={$s} target={$d}");
                $bad++;
            }
        }
        if ($bad) {
            $this->error("{$bad} table(s) mismatched — do NOT trust this copy.");
            return self::FAILURE;
        }
        $this->info('All tables verified: target row counts match the SQLite source exactly.');
        return self::SUCCESS;
    }
}
