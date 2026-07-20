# Database dumps

`epic-quote-estimator.sql` — a full MySQL/MariaDB dump (schema + data) of the working
database. **It is git-ignored** (see repo `.gitignore`): it is a point-in-time snapshot
of real customer data and goes stale as work continues, so it is handed to developers as
a file alongside the project, not committed.

## Import it (developer, XAMPP MySQL)
Stock XAMPP MySQL is `root` with no password.

```bash
# from the repo root
"C:\xampp\mysql\bin\mysql.exe" -u root < backend/database/dumps/epic-quote-estimator.sql
```

The dump begins with `CREATE DATABASE IF NOT EXISTS \`epic-quote-estimator\``, so the
database is created for you — no need to create it first. Or import via phpMyAdmin
(`http://localhost/phpmyadmin` → Import → choose this file).

After importing, get a known admin login:
```bash
cd backend && php artisan db:seed --class=UserSeeder   # sets test@123.com / 123456789!
```

## (Re)generate a fresh dump from the current database
```bash
"C:\xampp\mysql\bin\mysqldump.exe" -u root --databases "epic-quote-estimator" \
  --single-transaction --no-tablespaces --default-character-set=utf8mb4 \
  --routines --add-drop-table \
  > backend/database/dumps/epic-quote-estimator.sql
```

`--default-character-set=utf8mb4` is required — company addresses contain emoji/multibyte
characters that a latin1 dump would corrupt.
