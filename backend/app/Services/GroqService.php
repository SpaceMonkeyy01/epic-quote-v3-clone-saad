<?php

namespace App\Services;

use GuzzleHttp\Client;
use RuntimeException;

/**
 * Groq OpenAI-compatible chat completion (V1 call_groq).
 * Text model for text-only context; vision model when an image data URL is supplied.
 */
class GroqService
{
    private const URL = 'https://api.groq.com/openai/v1/chat/completions';

    /** @param string|array|null $images one image URL/data-URL, or an array of them (multi-upload jobs) */
    public function chat(string $prompt, $images = null, bool $jsonMode = false): string
    {
        $apiKey = config('services.groq.key');
        if (!$apiKey) {
            throw new RuntimeException('GROQ_API_KEY is not configured on the server (.env)');
        }

        $imageList = array_values(array_filter(is_array($images) ? $images : [$images]));
        if ($imageList) {
            $content = [['type' => 'text', 'text' => $prompt]];
            foreach (array_slice($imageList, 0, 5) as $url) {   // vision models cap the image count
                $content[] = ['type' => 'image_url', 'image_url' => ['url' => $url]];
            }
            $model = config('services.groq.vision_model');
        } else {
            $content = $prompt;
            $model = config('services.groq.model');
        }
        $imageDataUrl = (bool) $imageList;   // keep the json-mode guard below working

        $body = [
            'model'       => $model,
            'messages'    => [['role' => 'user', 'content' => $content]],
            'temperature' => 0.2,
            'max_tokens'  => 2000,
        ];
        // JSON mode guarantees valid, properly-escaped JSON (handles inch-marks etc.).
        // Only for text calls — some vision models reject response_format.
        if ($jsonMode && !$imageDataUrl) {
            $body['response_format'] = ['type' => 'json_object'];
        }

        $client = new Client(['timeout' => 60]);
        $res = $client->post(self::URL, [
            'headers' => [
                'Authorization' => "Bearer {$apiKey}",
                'Content-Type'  => 'application/json',
            ],
            'json' => $body,
        ]);

        $data = json_decode((string) $res->getBody(), true);
        return $data['choices'][0]['message']['content'] ?? '';
    }
}
