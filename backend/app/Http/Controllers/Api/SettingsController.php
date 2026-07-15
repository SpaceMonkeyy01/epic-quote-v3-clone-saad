<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class SettingsController extends Controller
{
    private const DEFAULT_LOGO = '/branding/epic_craftings_logo.svg';

    // GET /api/settings/logo — global company logo (#60,#124,#136)
    public function getLogo(): JsonResponse
    {
        $logo = Setting::get('company_logo');
        return response()->json([
            'logo' => $logo ? "/storage/logos/{$logo}" : self::DEFAULT_LOGO,
        ]);
    }

    // POST /api/settings/logo — replace global logo
    public function setLogo(Request $request): JsonResponse
    {
        $request->validate(['file' => 'required|file|mimes:jpg,jpeg,png,gif,webp|max:25600']);
        $file = $request->file('file');
        $ext = $file->getClientOriginalExtension();
        $filename = "company_logo.{$ext}";
        $file->storeAs('logos', $filename, 'public');
        Setting::put('company_logo', $filename);

        return response()->json(['logo' => "/storage/logos/{$filename}"]);
    }

    // PUT /api/settings/statuses — admin-managed quote-status list (#16). Renames/removals do
    // NOT touch existing quotes (they keep their old status string); the list only controls what
    // can be PICKED from here on. "Done" drives reports (won/conversion), so it can't be removed.
    public function setStatuses(Request $request): JsonResponse
    {
        if (!$request->user()->isAdmin()) {
            return response()->json(['error' => 'Only admins can manage statuses.'], 403);
        }
        $in = $request->input('statuses');
        if (!is_array($in) || $in === [] || count($in) > 30) {
            return response()->json(['error' => 'Send 1–30 statuses.'], 422);
        }
        $clean = [];
        foreach ($in as $s) {
            $s = trim((string) $s);
            if ($s === '' || mb_strlen($s) > 40) {
                return response()->json(['error' => 'Each status must be 1–40 characters.'], 422);
            }
            if (in_array($s, $clean, true)) {
                return response()->json(['error' => "Duplicate status \"{$s}\"."], 422);
            }
            $clean[] = $s;
        }
        if (!in_array('Done', $clean, true)) {
            return response()->json(['error' => '"Done" cannot be removed — reports and conversion metrics key off it.'], 422);
        }
        Setting::put('status_options', json_encode($clean));

        return response()->json(['statuses' => $clean]);
    }

    // GET /api/side-views — stored side-view images (#125)
    public function sideViews(): JsonResponse
    {
        $disk = Storage::disk('public');
        $out = [];
        if ($disk->exists('side_views')) {
            foreach ($disk->files('side_views') as $path) {
                if (preg_match('/\.(png|jpe?g|webp)$/i', $path)) {
                    $name = pathinfo($path, PATHINFO_FILENAME);
                    $base = basename($path);
                    $out[] = ['key' => $base, 'name' => $name, 'url' => "/storage/{$path}"];
                }
            }
        }

        return response()->json($out);
    }
}
