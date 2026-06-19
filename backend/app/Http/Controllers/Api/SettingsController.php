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
