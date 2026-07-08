<?php

namespace App\Console\Commands;

use App\Models\Company;
use App\Models\Representative;
use Illuminate\Console\Command;

/**
 * Import our own companies + contacts from an Airtable customer-list CSV (#9).
 *
 *   php artisan companies:import path/to/customers.csv
 *   php artisan companies:import path/to/customers.csv --dry-run
 *
 * Column headers are matched by name (case-insensitive), so the exact Airtable
 * export order doesn't matter. A "Company" column is required; Client / Phone /
 * Email / Address are optional. Idempotent: companies dedupe by name (case-
 * insensitive), contacts dedupe by (company, name) — re-running never duplicates,
 * and it backfills a blank phone/email/address on rows that already exist.
 */
class ImportCompanies extends Command
{
    protected $signature = 'companies:import {file : path to the Airtable CSV} {--dry-run : parse + report, write nothing}';

    protected $description = 'Import companies + contacts from an Airtable customer CSV';

    public function handle(): int
    {
        $file = $this->argument('file');
        if (!is_file($file)) {
            $this->error("File not found: {$file}");
            return self::FAILURE;
        }
        $fh = fopen($file, 'r');
        if (!$fh) {
            $this->error("Could not open: {$file}");
            return self::FAILURE;
        }

        $headers = array_map(fn ($h) => mb_strtolower(trim((string) $h)), fgetcsv($fh) ?: []);
        $col = function (array $names) use ($headers) {
            foreach ($names as $n) {
                $i = array_search($n, $headers, true);
                if ($i !== false) {
                    return $i;
                }
            }
            return null;
        };
        $ci = [
            'company' => $col(['company', 'company name', 'companyname', 'customer', 'retail company']),
            'client'  => $col(['client', 'client name', 'clientname', 'contact name', 'contact person']),
            'phone'   => $col(['phone', 'phone number', 'tel', 'telephone', 'mobile']),
            'email'   => $col(['email', 'e-mail', 'email address']),
            'address' => $col(['address', 'mailing address', 'company address', 'street address']),
        ];
        if ($ci['company'] === null) {
            $this->error('No "Company" column found. Headers seen: '.implode(', ', $headers));
            return self::FAILURE;
        }

        $dry = (bool) $this->option('dry-run');
        $rows = 0; $newCo = 0; $updCo = 0; $newRep = 0; $updRep = 0;
        $seenCo = [];   // dry-run in-memory dedupe so preview counts match a real run
        $seenRep = [];

        while (($r = fgetcsv($fh)) !== false) {
            $get = fn (string $k) => $ci[$k] !== null ? trim((string) ($r[$ci[$k]] ?? '')) : '';
            $company = $get('company');
            if ($company === '') {
                continue;   // skip rows with no company
            }
            $rows++;
            $client = $get('client');
            $phone = $get('phone');
            $email = $get('email');
            $address = $get('address');

            // company — dedupe by lower(name)
            $coKey = mb_strtolower($company);
            $co = Company::whereRaw('LOWER(name) = ?', [$coKey])->first();
            if (!$co) {
                if (!isset($seenCo[$coKey])) {
                    $newCo++;
                    $seenCo[$coKey] = true;
                }
                if (!$dry) {
                    $co = Company::create(['name' => $company, 'address' => $address, 'phone' => '', 'email' => '']);
                }
            } elseif ($address !== '' && !$co->address) {
                $updCo++;
                if (!$dry) {
                    $co->update(['address' => $address]);
                }
            }

            // contact — dedupe by (company, lower(name)); backfill blanks on an existing one
            if ($client !== '' && ($co || $dry)) {
                $repKey = $coKey.'|'.mb_strtolower($client);
                $rep = $co ? Representative::where('company_id', $co->id)
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower($client)])->first() : null;
                if (!$rep) {
                    if (!isset($seenRep[$repKey])) {
                        $newRep++;
                        $seenRep[$repKey] = true;
                    }
                    if (!$dry && $co) {
                        Representative::create(['company_id' => $co->id, 'name' => $client, 'phone' => $phone, 'email' => $email]);
                    }
                } else {
                    $patch = [];
                    if ($phone !== '' && !$rep->phone) $patch['phone'] = $phone;
                    if ($email !== '' && !$rep->email) $patch['email'] = $email;
                    if ($patch) {
                        $updRep++;
                        if (!$dry) $rep->update($patch);
                    }
                }
            }
        }
        fclose($fh);

        $this->info("Rows read: {$rows}");
        $this->info("Companies — new: {$newCo}, address-filled: {$updCo}");
        $this->info("Contacts  — new: {$newRep}, backfilled: {$updRep}");
        if ($dry) {
            $this->warn('Dry run — nothing was written. Re-run without --dry-run to import.');
        }
        return self::SUCCESS;
    }
}
