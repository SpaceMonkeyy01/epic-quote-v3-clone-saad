<?php

namespace App\Services;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;

/**
 * Two-way Airtable sync for quote IDs (the team's existing software manages IDs there).
 *  - nextQuoteId(): reads the highest quote ID in Airtable so our numbering continues it.
 *  - pushQuote(): writes/updates a quote row in Airtable so the old records stay current.
 * Completely inactive until the env vars are set — nothing breaks without them.
 *
 * Env (Render → Environment):
 *   AIRTABLE_API_KEY   personal access token (pat…)
 *   AIRTABLE_BASE_ID   app…
 *   AIRTABLE_TABLE     table name or tbl… id
 *   AIRTABLE_ID_FIELD  field holding the quote ID (default "Quote ID")
 */
class AirtableService
{
    public static function configured(): bool
    {
        return (bool) (env('AIRTABLE_API_KEY') && env('AIRTABLE_BASE_ID') && env('AIRTABLE_TABLE'));
    }

    private static function client(): Client
    {
        return new Client([
            'base_uri' => 'https://api.airtable.com/v0/'.env('AIRTABLE_BASE_ID').'/',
            'timeout'  => 15,
            'headers'  => ['Authorization' => 'Bearer '.env('AIRTABLE_API_KEY')],
        ]);
    }

    /** Highest EC-number found in Airtable (0 when none/unreachable) — our auto-ID continues past it. */
    public static function maxQuoteNumber(): int
    {
        if (!self::configured()) {
            return 0;
        }
        try {
            $field = env('AIRTABLE_ID_FIELD', 'Quote ID');
            $res = self::client()->get(rawurlencode(env('AIRTABLE_TABLE')), ['query' => [
                'fields[]' => $field,
                'sort[0][field]' => $field,
                'sort[0][direction]' => 'desc',
                'maxRecords' => 25,
            ]]);
            $data = json_decode((string) $res->getBody(), true);
            $max = 0;
            foreach ($data['records'] ?? [] as $rec) {
                if (preg_match('/EC(\d+)/i', (string) ($rec['fields'][$field] ?? ''), $m)) {
                    $max = max($max, (int) $m[1]);
                }
            }
            return $max;
        } catch (\Throwable $e) {
            Log::warning('Airtable maxQuoteNumber failed: '.$e->getMessage());
            return 0;
        }
    }

    /** Create/update the quote's row in Airtable (matched by quote ID). Fire-and-forget safe. */
    public static function pushQuote(string $quoteId, array $fields): void
    {
        if (!self::configured()) {
            return;
        }
        try {
            $idField = env('AIRTABLE_ID_FIELD', 'Quote ID');
            self::client()->patch(rawurlencode(env('AIRTABLE_TABLE')), ['json' => [
                'performUpsert' => ['fieldsToMergeOn' => [$idField]],
                'records' => [['fields' => array_merge([$idField => $quoteId], $fields)]],
            ]]);
        } catch (\Throwable $e) {
            Log::warning("Airtable pushQuote {$quoteId} failed: ".$e->getMessage());
        }
    }
}
