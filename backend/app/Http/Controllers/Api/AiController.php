<?php

namespace App\Http\Controllers\Api;

use App\Constants\AppConstants;
use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Quote;
use App\Services\GroqService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Smalot\PdfParser\Parser as PdfParser;
use Symfony\Component\Process\Process;

class AiController extends Controller
{
    public function __construct(private GroqService $groq) {}

    // POST /api/ai/generate-specs (V1 ai_generate_specs) — #73-81
    public function generateSpecs(Request $request): JsonResponse
    {
        $request->validate([
            'quote_id'     => 'required|string',
            'project_info' => 'nullable|string',
        ]);

        $quote = Quote::where('quote_id', $request->quote_id)->firstOrFail();
        if (!$quote->isVisibleTo($request->user())) {
            abort(403);
        }

        $extraInfo = trim((string) $request->input('project_info', ''));
        $sideViewKeys = trim((string) $request->input('side_view_keys', ''));

        // Customer file → PDF text (smalot) or image data URL (vision)
        $pdfText = '';
        $imageDataUrl = null;
        if ($quote->customer_pdf) {
            $disk = Storage::disk('public');
            $rel = 'pdfs/'.$quote->customer_pdf;
            if ($disk->exists($rel)) {
                $full = $disk->path($rel);
                if (str_ends_with(strtolower($quote->customer_pdf), '.pdf')) {
                    $pdfText = $this->extractPdfText($full);
                } else {
                    $ext = strtolower(pathinfo($quote->customer_pdf, PATHINFO_EXTENSION));
                    $mime = $ext === 'png' ? 'image/png' : "image/{$ext}";
                    $b64 = base64_encode(file_get_contents($full));
                    $imageDataUrl = "data:{$mime};base64,{$b64}";
                }
            }
        }

        // A rasterized PDF page (or any image) sent from the client takes precedence for vision —
        // this is how vector/CAD PDFs that carry no extractable text still get "seen".
        $reqImage = $request->input('image_data');
        if ($reqImage) {
            $imageDataUrl = 'data:' . $request->input('image_type', 'image/png') . ';base64,' . $reqImage;
        }

        $infoParts = array_filter([$quote->special_requirements, $extraInfo, $pdfText]);
        $info = $infoParts ? implode("\n\n", $infoParts) : '(no project details provided)';
        $signTypeList = implode("\n", AppConstants::SIGN_TYPE_NAMES);

        $imgNote = $imageDataUrl ? ' and the attached image of their document' : '';
        $prompt = <<<PROMPT
You are a sign-industry quoting assistant for Epic Craftings. Read the customer's project information{$imgNote} and produce quote specifications.

AVAILABLE SIGN TYPES (you MUST pick exactly one, verbatim):
{$signTypeList}

CUSTOMER PROJECT INFO:
{$info}

WHO IS OUR CLIENT — CRITICAL: Epic Craftings is a WHOLESALE sign manufacturer. This drawing was sent to us by a RETAIL sign company (OUR client) who resells to THEIR end customer. The retail company appears in the drawing's title block / footer / logo / contact details (e.g. "FastSigns Allentown"). The "Client:" field on the drawing names the END customer (e.g. "28 TEN Group") — that is NOT our client. Set companyName to the RETAIL sign company (our client); set endCustomer to the end customer.

Capture EVERY detail you can find — read all of it. For the structured fields below, pick the PRIMARY sign. For "fullSpec", write out EVERYTHING the document specifies (all dimensions, letter heights, materials, finishes/anodizing, fonts, standoffs, backlighting, every distinct sign, seals, etc.) as readable lines — do not omit anything. If multiple signs are described, list each.

Respond ONLY with a JSON object, no markdown fences, no preamble, with these keys (use null when unknown):
{
 "companyName": "the RETAIL sign company that sent this drawing (OUR client) — from the title block/footer/logo, else null",
 "endCustomer": "the end customer the retail company is selling to (often the drawing's 'Client:' field), else null",
 "signType": "one of the sign types above, verbatim",
 "jobName": "short job name",
 "dimensions": "primary sign overall dimensions, like 29\\" X 100\\"",
 "returns": "like 3\\" DEEP or null",
 "trimcap": "METALLIC TRIM CAP | JEWLITE TRIM CAP | STANDARD TRIM CAP | N/A | null",
 "mounting": "STUD MOUNT | FLUSH MOUNT | RACEWAY MOUNT | BACKER MOUNT | VHB MOUNT | null",
 "illumination": "6500K LED MODULES (3 YEAR WARRANTY) or other if specified, else null",
 "faceColor": "BLACK | WHITE | null",
 "returnColor": "BLACK | WHITE | null",
 "application": "EXTERIOR | INTERIOR | null",
 "price": number or null,
 "notes": "short summary of anything special, else null",
 "fullSpec": "EXHAUSTIVE multi-line transcription of every spec/detail found in the source (each sign, every dimension, material, finish, font, mounting, lighting). Never null if any detail exists."
}
PROMPT;

        if ($imageDataUrl && $sideViewKeys !== '') {
            $prompt .= "\n\nSIDE VIEW: From this exact list of construction side-view keys — {$sideViewKeys} — pick the ONE whose construction best matches the drawing. Add two more JSON keys: \"sideViewKey\" (exactly one key from the list, or null) and \"sideViewConfidence\" (a number from 0 to 1).";
        }

        try {
            $ai = $this->callAndParse($prompt, $imageDataUrl);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'AI generation failed: '.$e->getMessage()], 502);
        }

        ActivityLog::record($request->user()->id, 'ai_generate_specs', $quote->quote_id);

        return response()->json($ai);
    }

    /** Call Groq and robustly parse JSON, retrying once if the model returns junk. */
    private function callAndParse(string $prompt, ?string $imageDataUrl): array
    {
        $lastErr = null;
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $text = $this->groq->chat($prompt, $imageDataUrl, jsonMode: true);
            $parsed = $this->parseJson($text);
            if ($parsed !== null) {
                return $parsed;
            }
            $lastErr = 'model did not return valid JSON';
        }
        throw new \RuntimeException($lastErr ?? 'no response');
    }

    private function parseJson(string $text): ?array
    {
        // strip markdown fences
        $clean = trim(preg_replace('/```json|```/', '', $text));
        $decoded = json_decode($clean, true);
        if (is_array($decoded)) {
            return $decoded;
        }
        // fallback: extract the first {...} block (model wrapped JSON in prose)
        if (preg_match('/\{.*\}/s', $clean, $m)) {
            $decoded = json_decode($m[0], true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        return null;
    }

    private function extractPdfText(string $path, int $maxChars = 8000): string
    {
        // poppler's pdftotext handles compressed object-stream PDFs (Illustrator/InDesign
        // exports) that smalot/pdfparser returns empty for. Try it first, fall back to smalot.
        $text = $this->pdftotext($path);
        if (trim($text) === '') {
            try {
                $text = (new PdfParser())->parseFile($path)->getText();
            } catch (\Throwable $e) {
                $text = '';
            }
        }
        return mb_substr($text, 0, $maxChars);
    }

    /** Shell out to poppler's pdftotext; returns '' if it is not installed or fails. */
    private function pdftotext(string $path): string
    {
        try {
            $p = new Process(['pdftotext', '-layout', '-enc', 'UTF-8', $path, '-']);
            $p->setTimeout(20);
            $p->run();
            return $p->isSuccessful() ? $p->getOutput() : '';
        } catch (\Throwable $e) {
            return '';
        }
    }
}
