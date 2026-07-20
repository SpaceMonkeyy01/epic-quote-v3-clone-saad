# Local development setup — Epic Craftings Quote Generator

Stack: **Laravel 11** (PHP API) + **React 19 / Vite** (SPA) + **MySQL/MariaDB via XAMPP**.
This guide gets a fresh machine running against the transferred database.

> The app talks to the DB with `php artisan serve` (its own PHP server) and the SPA runs on
> Vite. **From XAMPP you only need MySQL** — Apache is optional (handy for phpMyAdmin).

---

## 1. Prerequisites
- **PHP 8.2+** (8.3 recommended) with `pdo_mysql`, `mbstring`, `fileinfo` extensions
- **Composer** (https://getcomposer.org)
- **Node.js 18+** (20/22/24 all fine) + npm
- **XAMPP** (for MySQL/MariaDB) — https://www.apachefriends.org

---

## 2. Start MySQL (XAMPP)
1. Open **XAMPP Control Panel**.
2. Click **Start** next to **MySQL** (also start **Apache** if you want phpMyAdmin).
3. MySQL now listens on `127.0.0.1:3306`, user `root`, **no password** (XAMPP default).

phpMyAdmin (optional DB browser): `http://localhost/phpmyadmin`

---

## 3. Import the database
You were given `backend/database/dumps/epic-quote-estimator.sql` (a full dump — schema + data).
It creates the `epic-quote-estimator` database for you.

**Command line:**
```bash
"C:\xampp\mysql\bin\mysql.exe" -u root < backend/database/dumps/epic-quote-estimator.sql
```

**or phpMyAdmin:** Import tab → choose the `.sql` file → Go.

Verify:
```bash
"C:\xampp\mysql\bin\mysql.exe" -u root -e "USE \`epic-quote-estimator\`; SELECT COUNT(*) FROM companies;"
# expect ~769
```

> If you cloned via git, the `.sql` is **not** in the repo (git-ignored — it holds real
> customer data). Ask for the file, or bootstrap an empty DB instead:
> create the database, then `cd backend && php artisan migrate --seed`.

---

## 4. Backend (Laravel API)
```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
php artisan storage:link       # serves uploaded artwork under /storage (Windows: run terminal as Admin)
```
`.env.example` already targets XAMPP (`DB_DATABASE=epic-quote-estimator`, `root`, blank password).
Confirm the DB block matches your XAMPP if you changed anything.

Known admin login (sets it explicitly, no guessing):
```bash
php artisan db:seed --class=UserSeeder     # → username: test@123.com   password: 123456789!
```

Run it:
```bash
php artisan serve                          # http://localhost:8000  (health: /api/health)
```

---

## 5. Frontend (React SPA)
In a second terminal:
```bash
cd frontend
npm install
npm run dev                                # http://localhost:5173
```
No frontend `.env` is needed — Vite proxies `/api` and `/storage` to the backend on `:8000`
(see `frontend/vite.config.js`). Open **http://localhost:5173** and log in with the credentials above.

---

## 6. What's NOT in the DB dump (expected)
- **Uploaded artwork files.** Quotes store artwork on Cloudinary (URLs still load) or in
  `backend/storage/app/public` (local files, not transferred). Old quotes may show a missing
  image; new uploads work normally. To carry the local files too, copy
  `backend/storage/app/public/**` from the source machine.
- **Secrets** (`.env` is git-ignored). AI mode (Groq) and Shopify payment links stay disabled
  until their keys are set in `.env` — core quoting works without them.

---

## 7. Troubleshooting
| Symptom | Fix |
|---|---|
| `SQLSTATE[HY000] [2002]` connection refused | MySQL isn't started in XAMPP. |
| `Unknown database 'epic-quote-estimator'` | Import step 3 didn't run, or DB name case mismatch — keep it lowercase. |
| Login always "Invalid username or password" | Run `php artisan db:seed --class=UserSeeder`, use `test@123.com` / `123456789!`. |
| Frontend loads but every API call fails | Backend (`php artisan serve`) isn't running on `:8000`. |
| `storage:link` fails on Windows | Run the terminal **as Administrator** (symlinks need it), or enable Developer Mode. |
| Artwork images broken on old quotes | Expected — see §6; upload fresh or copy the storage files. |

---

## 8. Everyday commands
```bash
# backend
cd backend && php artisan serve
# frontend
cd frontend && npm run dev
# re-dump the DB to hand off the latest data (see backend/database/dumps/README.md)
```

Deployment (Render) is separate — see `render.yaml`. This guide is local dev only.
