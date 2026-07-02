<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\UserCatalogItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Team catalog: custom sign types (with reusable spec templates) and uploaded side views.
 * Shared across every user and both quote modes — add once, available everywhere.
 */
class CatalogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $request->validate(['kind' => 'required|in:sign_type,side_view']);

        return response()->json(
            UserCatalogItem::where('kind', $request->query('kind'))
                ->orderBy('name')
                ->get(['id', 'kind', 'name', 'data'])
        );
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'kind' => 'required|in:sign_type,side_view',
            'name' => 'required|string|max:160',
            'data' => 'nullable|array',
        ]);
        $name = trim(mb_strtoupper($data['name']));
        if ($name === '') {
            return response()->json(['error' => 'Name is required.'], 422);
        }

        $item = UserCatalogItem::updateOrCreate(
            ['kind' => $data['kind'], 'name' => $name],
            ['data' => $data['data'] ?? []]
        );
        ActivityLog::record($request->user()->id, 'catalog_saved', "{$data['kind']}: {$name}");

        return response()->json($item);
    }

    public function destroy(Request $request, UserCatalogItem $item): JsonResponse
    {
        ActivityLog::record($request->user()->id, 'catalog_deleted', "{$item->kind}: {$item->name}");
        $item->delete();

        return response()->json(['ok' => true]);
    }
}
