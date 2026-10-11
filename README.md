# KindaJobs Directory — Firebase backend

The dynamic layer for the KindaJobs **directory** (pro accounts, dashboard, tools, later ratings + matching).
Kept **isolated** from the old lead-marketplace app — its own Firebase project, its own repo.

- **Firebase project:** `kindajobs-directory` (Blaze). Firestore region **nam5**. Auth: **Email link (passwordless)**.
- **Public directory stays on Netlify** (get-site). This repo is backend only; the pro-app pages live in `get-site`
  on kindajobs.com (`/login`, `/dashboard`, …), served by the same Netlify deploy.

## Phase 1 — "login in front of the token"

A logged-in pro's emailed magic-link token already authorizes editing. Instead of rebuilding the edit path,
Cloud Functions let an authenticated account **mint that same token**, and the pro app opens the existing
Apps Script manage flow (`list.html?manage=1&slug=..&t=..`) unchanged. Firestore holds only identity +
"who owns which listing"; **listing data stays in the Sheet / Apps Script**.

```
.firebaserc              -> project alias (kindajobs-directory)
firebase.json            -> functions + firestore config
firestore.rules          -> Phase-1 rules (accounts + listingClaims, deny-by-default)
firestore.indexes.json   -> (empty for Phase 1)
functions/index.js       -> resolveClaims (claim your listing) + mintEditToken (the token bridge)
scripts/seed-admin.js    -> one-off: grant an account admin
```

## The shared signing key (do this once)

The functions mint edit tokens with HMAC — the key **must be identical** to the Apps Script side, or the
token won't be trusted.

1. In the **Apps Script** project → Project Settings → Script Properties: ensure **`KJ_SIGNING_KEY`** is set to
   a random 32+ char string. If it's not already set, add one.
   ⚠️ Setting it (if it was previously unset) invalidates any outstanding emailed magic links — fine at this
   stage (accounts replace them), but re-send any that are mid-flight.
2. Set the **same value** as a Firebase secret:
   ```bash
   firebase functions:secrets:set KJ_SIGNING_KEY
   ```

## Deploy

```bash
npm --prefix functions install
firebase use kindajobs-directory
firebase deploy --only firestore:rules,functions
```

## Grant yourself admin (after you've signed in once)

```bash
# Project settings -> Service accounts -> Generate new private key -> save as serviceAccountKey.json (gitignored)
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/seed-admin.js you@kindajobs.com
```

## Still to wire (next drops)

- **Apps Script `?dirclaim` endpoint** (`resolveClaims` calls it): returns the slugs whose Directory Email ==
  a given email, gated by `sig = lsSign('dirclaim|'+email)`. One function + one route in the directory `.gs`.
- **Pro-app pages** in `get-site`: `/login` (send sign-in link), `/finish` (complete sign-in), `/dashboard`
  (your listings + Edit → `mintEditToken` → open the manage form), all `noindex`.
- **Email deliverability:** start on Firebase's built-in sender for testing; add a custom `@kindajobs.com`
  sender (SPF/DKIM) before launch.
