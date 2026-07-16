<?php

use App\Models\Company;
use App\Models\Quote;
use Illuminate\Support\Facades\Artisan;

/* companies:assign-reps maps each company (and backfills blank-rep quotes) to its account manager
   by EMAIL, from the real rep_map.csv. Rep assignment changes who owns a quote, so it's pinned.
   Uses Artisan::call (not $this->artisan, which needs Mockery — absent here, see Pest.php). */

it('assigns a company and backfills its blank-rep quote by email', function () {
    Company::create(['name' => 'Alpha Sign Company', 'email' => 'jim@alphasign.com']);
    $q = Quote::create(['quote_id' => 'EC900001', 'quote_num' => 900001, 'company_name' => 'Alpha Sign Company', 'email' => 'jim@alphasign.com', 'job_name' => 'Test', 'sales_rep' => '']);

    expect(Artisan::call('companies:assign-reps'))->toBe(0);

    expect(Company::firstWhere('email', 'jim@alphasign.com')->rep)->toBe('ED');   // one of Ed's emails
    expect($q->fresh()->sales_rep)->toBe('ED');
});

it('leaves a company with no email match blank', function () {
    Company::create(['name' => 'Ghost Signs', 'email' => 'nobody@no-such-domain-zzz.com']);

    expect(Artisan::call('companies:assign-reps'))->toBe(0);

    expect(Company::firstWhere('email', 'nobody@no-such-domain-zzz.com')->rep)->toBeNull();
});

it('never overwrites a quote that already has a rep — backfill fills only blanks', function () {
    $q = Quote::create(['quote_id' => 'EC900002', 'quote_num' => 900002, 'company_name' => 'Alpha Sign Company', 'email' => 'jim@alphasign.com', 'job_name' => 'Test', 'sales_rep' => 'Rod Muffet']);

    expect(Artisan::call('companies:assign-reps'))->toBe(0);

    expect($q->fresh()->sales_rep)->toBe('Rod Muffet');
});
