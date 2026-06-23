<?php

namespace App\Services;

use GuzzleHttp\Client;

/**
 * Minimal signed Cloudinary upload over the REST API (uses Guzzle — no extra composer dependency).
 * Returns a permanent CDN secure_url, so uploads are shared across instances and survive redeploys
 * (unlike the per-instance/ephemeral local disk). Caller falls back to local storage if this returns null.
 *
 * Credentials: CLOUDINARY_URL (cloudinary://key:secret@cloud) OR the three CLOUDINARY_* vars.
 */
class CloudinaryService
{
    private static function creds(): ?array
    {
        $url = env('CLOUDINARY_URL');
        if ($url && preg_match('#^cloudinary://(\d+):([^@]+)@(.+)$#', trim($url), $m)) {
            return ['key' => $m[1], 'secret' => $m[2], 'cloud' => $m[3]];
        }
        $cloud = env('CLOUDINARY_CLOUD_NAME');
        $key = env('CLOUDINARY_API_KEY');
        $secret = env('CLOUDINARY_API_SECRET');
        if ($cloud && $key && $secret) {
            return ['cloud' => $cloud, 'key' => $key, 'secret' => $secret];
        }
        return null;
    }

    public static function configured(): bool
    {
        return self::creds() !== null;
    }

    /** Upload a local file; returns its secure_url, or null if not configured / on failure. */
    public static function upload(string $localPath, string $folder = 'epic-quote', string $resourceType = 'image'): ?string
    {
        $c = self::creds();
        if (!$c || !is_file($localPath)) {
            return null;
        }
        $timestamp = time();
        // Cloudinary signature: sha1 of the signed params (sorted, &-joined, raw values) + api_secret.
        $signed = ['folder' => $folder, 'timestamp' => $timestamp];
        ksort($signed);
        $toSign = urldecode(http_build_query($signed));
        $signature = sha1($toSign . $c['secret']);
        try {
            $resp = (new Client(['timeout' => 40]))->post(
                "https://api.cloudinary.com/v1_1/{$c['cloud']}/{$resourceType}/upload",
                ['multipart' => [
                    ['name' => 'file',      'contents' => fopen($localPath, 'r'), 'filename' => basename($localPath)],
                    ['name' => 'api_key',   'contents' => $c['key']],
                    ['name' => 'timestamp', 'contents' => (string) $timestamp],
                    ['name' => 'folder',    'contents' => $folder],
                    ['name' => 'signature', 'contents' => $signature],
                ]]
            );
            $data = json_decode((string) $resp->getBody(), true);
            return $data['secure_url'] ?? null;
        } catch (\Throwable $e) {
            return null;
        }
    }
}
