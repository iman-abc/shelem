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
