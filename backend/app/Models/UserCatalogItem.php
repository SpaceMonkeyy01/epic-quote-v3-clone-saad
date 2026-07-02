<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserCatalogItem extends Model
{
    protected $fillable = ['kind', 'name', 'data'];

    protected $casts = ['data' => 'array'];
}
