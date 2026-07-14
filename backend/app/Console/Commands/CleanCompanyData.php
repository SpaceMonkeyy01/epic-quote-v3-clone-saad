<?php

namespace App\Console\Commands;

use App\Models\Company;
use App\Models\Representative;
use Illuminate\Console\Command;

/**
 * Data hygiene for the customer DB (#4): fields that landed in the wrong column, or in the
 * wrong format, are moved / cleaned:
 *
 *  reps      — email that is really a phone → phone; email without '@' → phone or dropped;
 *              phone that contains an email → email; whitespace/nbsp trimmed.
 *  companies — emails embedded in the address → company email (first one, when blank) and
 *              stripped from the address; "<...>" fragments and "For:/This is for:" tails
 *              removed; a phone-only address → company phone; stray backticks/quotes trimmed.
 *
 * Idempotent — a second run changes nothing. --dry-run reports without writing.
 *
 *   php artisan companies:clean [--dry-run]
 */
class CleanCompanyData extends Command
{
    protected $signature = 'companies:clean {--dry-run : report what would change, write nothing}';

    protected $description = 'Fix misplaced / malformed fields in the companies + contacts data';

    private const EMAIL_RE = '/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/';
    private const PHONE_RE = '/^[\d\s().+\-\/#]{7,}$/';

    public function handle(): int
    {
        $dry = (bool) $this->option('dry-run');
        $stats = ['rep_email_to_phone' => 0, 'rep_email_dropped' => 0, 'rep_phone_to_email' => 0,
                  'rep_trimmed' => 0, 'co_email_from_address' => 0, 'co_address_cleaned' => 0,
                  'co_address_to_phone' => 0];

        $norm = fn ($s) => trim(preg_replace('/\s+/u', ' ', str_replace("\u{00A0}", ' ', (string) $s)));

        // ---- representatives ----
        foreach (Representative::all() as $r) {
            $patch = [];
            $name = $norm($r->name); $phone = $norm($r->phone); $email = $norm($r->email);
            if ($name !== (string) $r->name || $phone !== (string) $r->phone || $email !== (string) $r->email) {
                $patch = ['name' => $name, 'phone' => $phone, 'email' => $email];
                $stats['rep_trimmed']++;
            }
            // email column holding a phone number
            if ($email !== '' && !str_contains($email, '@')) {
                if (preg_match(self::PHONE_RE, $email)) {
                    if ($phone === '') { $patch['phone'] = $email; $stats['rep_email_to_phone']++; }
                    else { $stats['rep_email_dropped']++; }
                } else {
                    $stats['rep_email_dropped']++;   // junk that is neither email nor phone
                }
                $patch['email'] = '';
                $patch['name'] = $name;
                $patch['phone'] = $patch['phone'] ?? $phone;
            }
            // phone column holding an email
            if (str_contains($phone, '@') && preg_match(self::EMAIL_RE, $phone, $m)) {
                if ($email === '' && !isset($patch['email'])) { $patch['email'] = strtolower($m[0]); $stats['rep_phone_to_email']++; }
                $patch['phone'] = $norm(str_replace($m[0], '', $phone));
            }
            if ($patch && !$dry) $r->update($patch);
        }

        // ---- companies ----
        foreach (Company::all() as $c) {
            $addr = $norm($c->address); $phone = $norm($c->phone); $email = $norm($c->email);
            $orig = [$addr, $phone, $email];

            // pull embedded emails out of the address
            if (preg_match_all(self::EMAIL_RE, $addr, $m) && $m[0]) {
                if ($email === '') { $email = strtolower($m[0][0]); $stats['co_email_from_address']++; }
                foreach ($m[0] as $e) $addr = str_replace($e, '', $addr);
            }
            // strip "<...>" fragments and "For: / This is for: / Attn:" tails, junk chars.
            // /u throughout — these addresses contain emoji; a non-unicode replace can slice a
            // multibyte char in half and MySQL then rejects the whole row as invalid UTF-8.
            $addr = preg_replace('/<[^>]*>?/u', '', $addr) ?? $addr;
            $addr = preg_replace('/\b(this is for|for|attn)\s*:\s*[A-Za-z .\'-]*$/iu', '', $addr) ?? $addr;
            $addr = preg_replace('/[\x{2600}-\x{27BF}\x{1F000}-\x{1FAFF}\x{FE0F}]/u', '', $addr) ?? $addr;  // pictographs add nothing to an address
            if (!mb_check_encoding($addr, 'UTF-8')) {
                $addr = mb_convert_encoding($addr, 'UTF-8', 'UTF-8');   // drop any invalid bytes
            }
            $addr = trim($norm($addr), " ,;|`\"'-–—");
            // a phone-only "address" belongs in the phone column
            if ($addr !== '' && preg_match(self::PHONE_RE, $addr)) {
                if ($phone === '') { $phone = $addr; $stats['co_address_to_phone']++; }
                $addr = '';
            }
            if ([$addr, $phone, $email] !== $orig) {
                $stats['co_address_cleaned']++;
                if (!$dry) $c->update(['address' => $addr, 'phone' => $phone, 'email' => $email]);
            }
        }

        // ---- v2 (#4, Sami 2026-07-14): meaningful entries only ----
        $stats['co_rolename_deleted'] = 0;
        $stats['rep_dupe_merged'] = 0;
        $stats['rep_roleonly_deleted'] = 0;

        // A "company" whose name is really a job title / junk. Only deleted when NOTHING points
        // at it (no quotes) — a role-named company with real quotes needs a human rename instead.
        $roleRe = '/^(office|office manager|owner|manager|sales|sales rep(resentative)?|project manager|'
                .'accounting|accounts?|front desk|admin|receptionist|estimator|designer|purchasing|'
                .'n\/?a|none|unknown|test|tbd)([ \/|&-]+(office|manager|owner|sales|project manager|admin))*$/iu';
        foreach (Company::all() as $c) {
            if (!preg_match($roleRe, $norm($c->name))) {
                continue;
            }
            $hasQuotes = \App\Models\Quote::where('company_id', $c->id)->exists()
                || \App\Models\Quote::whereRaw('LOWER(company_name) = ?', [mb_strtolower($norm($c->name))])->exists();
            if ($hasQuotes) {
                $this->warn("kept role-named company (has quotes): {$c->name}");
                continue;
            }
            $stats['co_rolename_deleted']++;
            if (!$dry) {
                Representative::where('company_id', $c->id)->delete();
                $c->delete();
            }
        }

        // Redundant contacts per company ("Sharon Khoo" three ways): group by normalized name,
        // keep the most complete row (email + phone filled beats blank; longer name breaks ties),
        // fold any missing email/phone from the dupes into the survivor, delete the rest.
        $repKey = fn ($s) => preg_replace('/[^a-z0-9]/', '', mb_strtolower($norm($s)));
        foreach (Company::all() as $c) {
            $groups = [];
            foreach (Representative::where('company_id', $c->id)->get() as $r) {
                $k = $repKey($r->name);
                if ($k === '') continue;
                $groups[$k][] = $r;
            }
            foreach ($groups as $g) {
                if (count($g) < 2) continue;
                usort($g, fn ($a, $b) =>
                    [(int) !empty($b->email) + (int) !empty($b->phone), mb_strlen($b->name)]
                    <=> [(int) !empty($a->email) + (int) !empty($a->phone), mb_strlen($a->name)]);
                $keep = array_shift($g);
                $patch = [];
                foreach ($g as $dupe) {
                    if (!$keep->email && $dupe->email) { $patch['email'] = $dupe->email; $keep->email = $dupe->email; }
                    if (!$keep->phone && $dupe->phone) { $patch['phone'] = $dupe->phone; $keep->phone = $dupe->phone; }
                    $stats['rep_dupe_merged']++;
                    if (!$dry) $dupe->delete();
                }
                if ($patch && !$dry) $keep->update($patch);
            }
        }

        // A contact whose NAME is just a role word and who has no email AND no phone is noise.
        foreach (Representative::all() as $r) {
            if (preg_match($roleRe, $norm($r->name)) && !$norm($r->email) && !$norm($r->phone)) {
                $stats['rep_roleonly_deleted']++;
                if (!$dry) $r->delete();
            }
        }

        foreach ($stats as $k => $v) $this->info(str_pad($k, 26).$v);
        if ($dry) $this->warn('Dry run — nothing written.');
        return self::SUCCESS;
    }
}
