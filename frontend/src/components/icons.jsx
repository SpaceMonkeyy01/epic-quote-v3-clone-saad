/* Lucide-style stroke icons (SVG, no emoji) — one consistent family for the whole app.
   Every icon inherits `currentColor` + a 1.8 stroke so they sit on the same visual weight. */
const S = ({ children, size = 18, sw = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

export const IcHome = (p) => <S {...p}><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10h14V10" /></S>
export const IcQuotes = (p) => <S {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></S>
export const IcTeam = (p) => <S {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13A4 4 0 0 1 16 11" /></S>
export const IcUsers = (p) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></S>
export const IcReports = (p) => <S {...p}><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></S>
export const IcActivity = (p) => <S {...p}><path d="M3 12h4l3 8 4-16 3 8h4" /></S>
export const IcCard = (p) => <S {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></S>
export const IcSun = (p) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></S>
export const IcBell = (p) => <S {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></S>
export const IcTrendUp = (p) => <S {...p}><path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" /></S>
export const IcDollar = (p) => <S {...p}><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></S>
export const IcGauge = (p) => <S {...p}><path d="M12 14 15 9" /><path d="M3.3 17a9 9 0 1 1 17.4 0" /></S>
export const IcClipboard = (p) => <S {...p}><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" /></S>
export const IcSpinner = (p) => <S {...p}><path d="M21 12a9 9 0 1 1-6.2-8.5" /></S>
export const IcImage = (p) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></S>
export const IcCheck = (p) => <S {...p}><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" /><path d="m9 11 3 3L22 4" /></S>
export const IcSend = (p) => <S {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></S>
export const IcChevR = (p) => <S {...p}><path d="m9 6 6 6-6 6" /></S>
export const IcChevD = (p) => <S {...p}><path d="m6 9 6 6 6-6" /></S>
export const IcAlert = (p) => <S {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></S>
export const IcMail = (p) => <S {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></S>
export const IcPlus = (p) => <S {...p}><path d="M12 5v14M5 12h14" /></S>
export const IcClock = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>
export const IcPause = (p) => <S {...p}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></S>
export const IcX = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></S>
export const IcHourglass = (p) => <S {...p}><path d="M6 3h12M6 21h12M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9" /></S>
export const IcShare = (p) => <S {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5" /></S>
