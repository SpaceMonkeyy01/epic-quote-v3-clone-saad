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

        foreach ($stats as $k => $v) $this->info(str_pad($k, 26).$v);
        if ($dry) $this->warn('Dry run — nothing written.');
        return self::SUCCESS;
    }
}
