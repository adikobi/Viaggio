# Viaggio
1. Google Cloud: enable **Maps JavaScript API, Places API (New), Routes API**; create a key restricted to your Pages domain (HTTP referrer). Free monthly credit covers personal use.
2. Local: `cp .env.local.example .env.local`, add key, `npm i && npm run dev`.
3. Deploy: push to `main`; repo Settings → Pages → Source: GitHub Actions; Settings → Secrets → add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

## Sync (optional, free Spark plan)
1. console.firebase.google.com → new project → add Web app → copy config into `.env.local` / GitHub secrets (`NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID`).
2. Build → Authentication → enable **Google**; Settings → Authorized domains → add `<user>.github.io`.
3. Build → Firestore → create DB, rules:
```
match /databases/{d}/documents { match /users/{uid} { allow read, write: if request.auth.uid == uid; } }
```
