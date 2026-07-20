# XAMPP — plain-English quickstart (for Sami)

XAMPP is just a little control panel that runs the **database** (MySQL) your app needs on
your own computer. You do **not** need to understand it — you only ever press two Start buttons.

---

## Every time you want to work on the app

### 1. Turn the database on
1. Open **XAMPP Control Panel** (search "XAMPP" in the Start menu).
2. Next to **MySQL**, click **Start**. Wait until it turns **green** and shows numbers under "PID(s)".
3. (Optional) Click **Start** next to **Apache** too — only needed if you want to open the
   database viewer at `http://localhost/phpmyadmin`.

That's it. The database is now running. You can minimize XAMPP.

> Green = running. If it won't turn green, another program is using the port — close it and
> press Start again, or restart the PC.

### 2. Start the app (two windows)
Open **two** terminal windows in the project folder (`F:\qoute_generator\epic-quote-v3`):

**Window 1 — the backend:**
```
cd backend
php artisan serve
```
Leave it running. It says "Server running on http://localhost:8000".

**Window 2 — the website:**
```
cd frontend
npm run dev
```
It prints a link like `http://localhost:5173` — open that in your browser.

### 3. Log in
- Username: `test@123.com`
- Password: `123456789!`

---

## When you're done
- Close the two terminal windows (or press `Ctrl + C` in each).
- In XAMPP, click **Stop** next to MySQL (and Apache if you started it). Optional — it's fine
  to leave them running.

---

## Handing the project to the developers
Everything they need is in the project folder:
- The **code** is already on both GitHub remotes (they can clone it).
- The **database** is the file `backend/database/dumps/epic-quote-estimator.sql`.
- Their step-by-step setup is in **`DEV_SETUP.md`** at the top of the project.

**Simplest transfer:** zip the whole `epic-quote-v3` folder and send it — the database file is
inside. (It is deliberately kept out of GitHub because it contains customer data.)

If you make more changes/quotes later and want the devs to have the newest data, tell me
"re-dump the database" and I'll refresh that `.sql` file for you to send again.
