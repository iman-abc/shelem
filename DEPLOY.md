# Free hosting for Shelem (static site, folder: `app/`)

## Option A — Netlify Drop (fastest, no account setup needed to try)
1. Open https://app.netlify.com/drop
2. Drag the `app` folder onto the page. You get a `https://xxxx.netlify.app` URL.
3. To update: drag the folder again (or sign up and link the site).

## Option B — Cloudflare Pages (free, unlimited bandwidth)
1. dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets.
2. Upload the `app` folder, deploy. URL: `https://<name>.pages.dev`.

## Option C — GitHub Pages (auto-deploys on every push)
1. Create a GitHub repo, push this project to the `main` branch.
2. Repo Settings → Pages → Source: **GitHub Actions**.
3. `.github/workflows/pages.yml` publishes `app/` to `https://<user>.github.io/<repo>/`.

All paths are relative, so it works in a sub-folder URL. HTTPS is required for the
offline/installable (service worker) features; all three options provide it.
Note: user data lives in each person's browser (localStorage). Use "دانلود خروجی" to back up.

---
# Server (login + per-user games) with Supabase — free

The app works without it (local-only). To enable accounts and cloud storage:

1. https://supabase.com → sign up → **New project** (any name/region, set a database password).
2. **SQL Editor → New query** → paste all of `supabase/01_schema.sql` → **Run**.
3. New query → paste `supabase/02_create_admin.local.sql` → **Run**. This creates the admin
   user (`admin`). That file is git-ignored on purpose (it holds the initial password) - **change
   the password after the first login** (account button → تغییر رمز).
4. **Project Settings → API**: copy **Project URL** and the **anon / publishable key**, paste into
   `app/config.js`. (This key is public by design; the tables are private and only reachable
   through the login-checked functions in the SQL file.)
5. Commit + push → the site redeploys. Open it → login screen appears.

Admin: account button (top-left) → **مدیریت کاربران** to create users, reset passwords, disable users.
Sync: each user's games are saved locally first, then synced when online (also on reconnect).
Conflict rule: if the same game was edited on two devices, the most recent sync wins for that game.
