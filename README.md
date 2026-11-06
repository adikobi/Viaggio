# Viaggio
1. Google Cloud: enable **Maps JavaScript API, Places API (New), Routes API**; create a key restricted to your Pages domain (HTTP referrer). Free monthly credit covers personal use.
2. Local: `cp .env.local.example .env.local`, add key, `npm i && npm run dev`.
3. Deploy: push to `main`; repo Settings → Pages → Source: GitHub Actions; Settings → Secrets → add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
