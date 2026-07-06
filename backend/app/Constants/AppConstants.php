<?php

namespace App\Constants;

/**
 * Verbatim catalogs from V1 backend.py. These strings MUST match V1 exactly —
 * AI sign-type matching is by exact name, and status/tag validation compares
 * against these literals. Do not rename, reorder is harmless but renaming breaks lookup.
 */
class AppConstants
{
    // V1 STATUS_OPTIONS (10 fixed)
    public const STATUS_OPTIONS = [
        'To Do',
        'In Progress',
        'Artwork Needed',
        'Quote Approval Needed',
        'Need Payment Link Sent',
        'Need To Share With Customer',
        'Awaiting Customer Response',
        'Awaiting Rod Response',
        'Awaiting Sir Sami Response',
        'On Hold',
        'Rejected by Client',
        'Out of Scope',
        'Done',
    ];

    // V1 SALES_REPS
    public const SALES_REPS = ['Rod Muffet', 'ED'];

    // V1 QUOTE_SOURCES
    public const QUOTE_SOURCES = ['Email', 'Client Portal'];

    // V1 ROLES
    public const ROLES = ['admin', 'sales_rep', 'manager'];

    // V1 SIGN_TYPE_NAMES (29 — verbatim from app.js T array)
    public const SIGN_TYPE_NAMES = [
        'FACE LIT CHANNEL LETTERS',
        'FACE LIT CHANNEL LETTERS WITH RACEWAY',
        'FACE LIT CHANNEL LETTERS WITH BACKER',
        'FACE LIT CHANNEL LETTERS WITH ACM BACKER',
        'HALO LIT CHANNEL LETTERS',
        'HALO LIT CHANNEL LETTERS WITH RACEWAY',
        'HALO LIT CHANNEL LETTERS WITH BACKER',
        'HALO LIT CHANNEL LETTERS WITH ACM BACKER',
        'FACE AND HALO LIT CHANNEL LETTERS',
        'FACE & HALO LIT CHANNEL LETTERS WITH BACKER',
        'FACE & HALO LIT CHANNEL LETTERS WITH ACM BACKER & RACEWAY',
        'FACE & HALO LIT CHANNEL LETTERS ON FLAT ALUMINUM BACKER & RACEWAY',
        'FACE LIT & HALO LIT CHANNEL LETTERS & LOGO ON ROUTED BACKER & RACEWAY AND PILL BOX',
        'FACE & HALO LIT CABINET',
        'MARQUEE CHANNEL LETTERS',
        '1/4" FLAT CUT ALUMINUM LETTERS',
        '1/2" FLAT CUT ALUMINUM LETTERS',
        '1/4" FLAT CUT ACRYLIC LETTERS',
        '1/2" FLAT CUT ACRYLIC LETTERS',
        'LED NEON SIGN (WALL MOUNTED)',
        'LED NEON SIGN (SUSPENDED FROM CEILING)',
        'OPEN FACE CHANNEL LETTER WITH FAUX NEON',
        'OPEN FACE CHANNEL LETTER WITH FAUX NEON ON RACEWAY',
        'PUSH THRU ILLUMINATED CABINET (SINGLE SIDED)',
        'PUSH THRU ILLUMINATED CABINET WITH HALO LIT BACK',
        'DOUBLE SIDED PUSH THRU ILLUMINATED CABINET',
        'SINGLE SIDED ILLUMINATED CABINET',
        'DOUBLE SIDED ILLUMINATED CABINET',
        'SINGLE SIDED ROUTED & BACKED UP ACRYLIC CABINET',
    ];
}
