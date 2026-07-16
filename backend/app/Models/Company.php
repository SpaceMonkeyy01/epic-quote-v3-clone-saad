<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Company extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'address', 'phone', 'email', 'rep'];

    public function representatives()
    {
        return $this->hasMany(Representative::class);
    }

    public function quotes()
    {
        return $this->hasMany(Quote::class);
    }
}
