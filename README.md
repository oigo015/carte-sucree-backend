# Carte Sucrée – Routes API backend

This tiny project has one job: call Google Maps Platform's Routes API on
behalf of the Carte Sucrée frontend, so the Google API key never appears in
the browser.

**Read the "Cost and safety" section below before deploying.** This app
calls a paid Google API. Several safeguards are built in on the frontend,
but none of them are a substitute for setting a real budget alert in
Google Cloud.

## Deploy to Vercel

1. Create a new (empty) GitHub repository, e.g. `carte-sucree-backend`.
2. Upload these files (`api/route.js`, `package.json`) to it, keeping the
   `api/route.js` path exactly as-is — Vercel automatically turns any file
   under `/api` into a serverless function.
3. Go to https://vercel.com, sign in with GitHub, click "Add New… → Project",
   and import the repository you just created.
4. Before or after the first deploy, open **Project Settings →
   Environment Variables** and add:
   - Key: `GOOGLE_MAPS_API_KEY`
   - Value: your Google Maps Platform API key
   Redeploy if you add this after the first deploy, so it takes effect.
5. Vercel gives you a URL like `https://carte-sucree-backend.vercel.app`.
   Your endpoint is `https://carte-sucree-backend.vercel.app/api/route`.
6. Put that URL into `TRANSIT_BACKEND_URL` near the top of Carte Sucrée's
   `index.html`. Until you do, the frontend will show "経路検索サービスが
   設定されていません" instead of calling anything.

## Google Cloud setup

1. In Google Cloud Console, open the project tied to your API key.
2. APIs & Services → Library → search "Routes API" → Enable.
3. Attach a billing account (required even for free-tier usage).
4. Credentials → edit your API key → **API restrictions** → restrict it to
   "Routes API" only. This limits what a leaked key could be used for.
   (Application restrictions such as HTTP referrer don't apply here, since
   the key is only ever called server-to-server from Vercel, not from a
   browser.)
5. **Set a budget alert**: Billing → Budgets & alerts → Create budget.
   Even a $1–$5/month budget with email alerts at 50%/90%/100% gives you an
   early warning if usage is ever higher than expected. This is the only
   safeguard that isn't just running inside client-side JavaScript.

## Cost and safety

### Why this needs care

Google Maps Platform's Routes API is a **paid API**. As of the March 2025
pricing change, there is no longer a blanket $200/month credit — instead,
each API has its own monthly free-usage cap (Routes API's "Compute Routes
Essentials" tier currently includes 10,000 free requests/month), and usage
beyond that is billed per request. For personal, occasional use, staying
inside the free tier is realistic, but it is not automatic — it depends on
how often the app is actually opened and how well the safeguards below are
working.

### Requests per single "近くのお店" refresh

- The frontend only ever sends requests for the **nearest 10 registered
  stores** (`REAL_TRANSIT_TOP_N = 10` in `index.html`), never all 85.
- Each of those 10 is **one request to this Vercel backend**.
- Each backend request makes **exactly 1 call to Google's Routes API**
  (TRANSIT). There is **no automatic fallback call** for walking directions
  — this app is for comparing distance/time/fare before deciding where to
  go, not for turn-by-turn navigation, so once you pick a store you're
  handed off to Apple Maps for the actual route (walking or otherwise).
- **Flat maximum: 10 backend requests → at most 10 Google API calls**, no
  matter the time of day or how many stores currently have no transit
  running.

### How caching reduces this further

- Results are cached in the browser (`realTransitCache`) for **7 minutes**
  (`TRANSIT_CACHE_TTL_MS`). Reopening the app, switching filters, or
  switching away from and back to public-transit mode within that window
  reuses the cached result instead of calling the API again.
- A **new geolocation fix does not automatically clear the cache** unless
  you've moved more than **300m** (`POSITION_CHANGE_THRESHOLD_KM`) from
  where the cache was last built. Small GPS jitter, or just reopening the
  page in the same spot, will not trigger new billable requests.
- A request that fails (`error` status) is **never retried automatically**.
  It only gets another chance once the cache is cleared by a genuine
  location change, or the 7-minute TTL expires.
- There is no polling or auto-refresh timer anywhere in the app — requests
  only happen in response to you opening the app, pressing the location
  button, or switching to public-transit mode.

### Daily request cap (client-side only)

- The frontend counts how many times it has actually called this backend
  today, using `localStorage` (`DAILY_API_LIMIT = 50` in `index.html`).
- Once 50 backend requests have been made in a day, the app stops calling
  the backend entirely and shows "本日の経路検索上限に達しました" for any
  store that would otherwise be checked.
- **This is a soft limit only.** It lives in the browser's `localStorage`,
  which the user (or anyone using the same browser) can clear at any time,
  and it obviously doesn't apply if the backend is called from anywhere
  else. It is meant to catch accidental runaway usage during normal use of
  this specific app in this specific browser — **it is not a real billing
  safeguard.** The Google Cloud budget alert described above is the actual
  safety net; consider also setting a hard quota on the Routes API in
  Google Cloud Console (APIs & Services → Routes API → Quotas) if you want
  a server-side cutoff.

### What is never shown for public transit

To avoid misleading estimates, the frontend **never shows a straight-line-
distance estimate for public transit** — only real Routes API results, or
one of these explicit status messages: "経路を検索中…" (searching),
"現在利用できる公共交通機関の経路なし" (no transit currently running),
"公共交通機関の情報を取得できませんでした" (request failed), "本日の経路
検索上限に達しました" (daily cap reached), or "経路検索サービスが設定さ
れていません" (backend URL not configured). Estimates are still used for
car/bike/walk modes, which were not part of this change.

## Testing the endpoint directly

```bash
curl -X POST https://carte-sucree-backend.vercel.app/api/route \
  -H 'Content-Type: application/json' \
  -d '{"origin":{"lat":35.1815,"lng":136.9066},"destination":{"lat":35.1237,"lng":136.8832}}'
```

A working response looks like:

```json
{"available":true,"durationSeconds":1620,"arrivalTime":"2026-09-19T15:47:00.000Z","fare":{"currencyCode":"JPY","amount":210}}
```

or, when no transit is currently running:

```json
{"available":false}
```
