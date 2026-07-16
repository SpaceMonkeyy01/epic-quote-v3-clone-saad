<?php

namespace App\Console\Commands;

use App\Models\Company;
use App\Models\Quote;
use Illuminate\Console\Command;

/**
 * Assign each company's account manager (Rod Muffet / ED) from the team's Airtable data, matched by
 * EMAIL — the one clean, unambiguous key. 288 emails, ZERO rep conflicts; email is what tells
 * FastSigns Buckhead (Ed) from FastSigns Everett (Rod) apart, which a shared domain (fastsigns.com,
 * signarama.com) or the messy free-text company name never could.
 *
 * Sets companies.rep, and backfills sales_rep on existing quotes whose rep is blank (by the quote's
 * own contact email). A company/quote with no email match is left blank — per decision. Idempotent;
 * --dry-run reports without writing.
 *
 *   php artisan companies:assign-reps --dry-run
 *   php artisan companies:assign-reps
 */
class AssignCompanyReps extends Command
{
    protected $signature = 'companies:assign-reps {--csv=database/data/rep_map.csv} {--dry-run}';

    protected $description = 'Set company + quote account manager (rep) from the Airtable email→rep map';

    public function handle(): int
    {
        $path = base_path($this->option('csv'));
        if (!is_file($path)) {
            $this->error("CSV not found: {$path}");
            return self::FAILURE;
        }
        $dry = (bool) $this->option('dry-run');
        $norm = fn ($e) => rtrim(strtolower(trim((string) $e)), ',');

        // email (normalized) → rep
        $map = [];
        $fh = fopen($path, 'r');
        fgetcsv($fh); // header
        while (($row = fgetcsv($fh)) !== false) {
            $email = $norm($row[0] ?? '');
            $rep = trim((string) ($row[1] ?? ''));
            if ($email !== '' && $rep !== '') {
                $map[$email] = $rep;
            }
        }
        fclose($fh);
        $this->info(count($map).' email→rep pairs loaded.');

        // 1) companies.rep — matched by the company's email
        $coSet = 0;
        $coSkip = 0;
        foreach (Company::whereNotNull('email')->where('email', '!=', '')->get() as $c) {
            $rep = $map[$norm($c->email)] ?? null;
            if (!$rep) {
                continue;
            }
            if ((string) $c->rep === $rep) {
                $coSkip++;
                continue;
            }
            $this->line(($dry ? '[dry] ' : '')."company {$c->name}: rep → {$rep}");
            if (!$dry) {
                $c->update(['rep' => $rep]);
            }
            $coSet++;
        }

        // 2) backfill quotes.sales_rep where blank — by the quote's own contact email
        $qSet = 0;
        $quotes = Quote::where(function ($q) {
            $q->whereNull('sales_rep')->orWhere('sales_rep', '');
        })->whereNotNull('email')->where('email', '!=', '')->get();
        foreach ($quotes as $q) {
            $rep = $map[$norm($q->email)] ?? null;
            if (!$rep) {
                continue;
            }
            $this->line(($dry ? '[dry] ' : '')."quote {$q->quote_id}: sales_rep → {$rep}");
            if (!$dry) {
                $q->update(['sales_rep' => $rep]);
            }
            $qSet++;
        }

        $verb = $dry ? 'would set' : 'set';
        $this->info("companies {$verb}: {$coSet} (already correct {$coSkip}) · quotes backfilled: {$qSet}");
        return self::SUCCESS;
    }
}
