/*  KindaJobs Directory — Cloud Functions (Phase 1)
 *  ----------------------------------------------------------------------------------------------
 *  The whole "no rebuild" trick: a logged-in pro's emailed magic-link token ALREADY authorizes editing
 *  their listing. So instead of rebuilding the edit path, these functions let an authenticated account
 *  MINT that same token on demand. The pro app then opens the existing Apps Script manage/edit flow
 *  (list.html?manage=1&slug=..&t=..) unchanged.
 *
 *  Firestore holds ONLY: accounts/{uid} (identity) + listingClaims/{slug} (who owns which listing).
 *  Listing DATA stays in the Google Sheet / Apps Script. Nothing in the directory backend changes.
 *
 *  SECRET: KJ_SIGNING_KEY must be IDENTICAL to the KJ_SIGNING_KEY Script Property in the Apps Script
 *  project — that is how the token this file mints is trusted by Apps Script with zero network call.
 *    Set it:  firebase functions:secrets:set KJ_SIGNING_KEY
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const KJ_SIGNING_KEY = defineSecret("KJ_SIGNING_KEY");
const REGION = "us-east1";

// The Apps Script /exec URL (public — same one the directory + render layer already use).
const EXEC_URL =
  "https://script.google.com/macros/s/AKfycbxd2HszToQyYmsKQjq7zc8rB0CxFEr9i37oKvyF7ATqTw5kFKVzUFs2XMmYRao2QXXTRg/exec";

// ---- byte-identical port of the Apps Script lsSign_ / lsExpToken_ ----
// Apps Script: base64EncodeWebSafe( HMAC-SHA256(data, key) ) with trailing '=' stripped === Node base64url.
function lsSign(data, key) {
  return crypto.createHmac("sha256", key).update(String(data), "utf8").digest("base64url");
}
function lsExpToken(payload, days, key) {
  const exp = Math.floor(Date.now() / 1000) + Math.round((days || 1) * 86400);
  return exp + "." + lsSign(payload + "|" + exp, key);
}

/* resolveClaims — a logged-in pro claims every Directory listing whose Email matches their VERIFIED email.
 * Firebase email-link sign-in proves the email, so auth.token.email is trustworthy. Writes listingClaims/{slug}.
 * Idempotent: safe to call on every login/dashboard load. Returns the slugs the pro owns. */
exports.resolveClaims = onCall({ secrets: [KJ_SIGNING_KEY], region: REGION }, async (req) => {
  const auth = req.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = auth.uid;
  const email = String((auth.token && auth.token.email) || "").trim().toLowerCase();
  if (!email || (auth.token && auth.token.email_verified === false)) {
    throw new HttpsError("failed-precondition", "No verified email on this account.");
  }
  const key = KJ_SIGNING_KEY.value();

  // ensure the account doc exists (identity record; Admin SDK write bypasses rules)
  await db.collection("accounts").doc(uid).set(
    { email, role: "pro", accountStatus: "active", createdAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  // ask Apps Script which slugs carry this email — SIGNED so only something holding KJ_SIGNING_KEY can call it
  const sig = lsSign("dirclaim|" + email, key);
  const url = EXEC_URL + "?dirclaim=1&email=" + encodeURIComponent(email) + "&sig=" + encodeURIComponent(sig);
  let slugs = [];
  try {
    const r = await fetch(url, { redirect: "follow" });
    const d = await r.json();
    if (d && d.ok && Array.isArray(d.slugs)) slugs = d.slugs.map(String);
  } catch (e) {
    throw new HttpsError("unavailable", "Couldn't reach the listing service. Try again in a moment.");
  }

  // bind each matched slug to this uid (Admin SDK bypasses rules, so a client can never forge a claim)
  if (slugs.length) {
    const batch = db.batch();
    slugs.forEach((slug) => {
      batch.set(
        db.collection("listingClaims").doc(slug),
        { ownerUid: uid, email, verifiedVia: "email-match", claimedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    });
    await batch.commit();
  }
  return { slugs };
});

/* mintEditToken — for a listing this uid OWNS, mint the same short-lived edit token the magic-link emails use,
 * so the pro app can open the existing manage/edit flow with no backend rebuild. ~1 day expiry. */
exports.mintEditToken = onCall({ secrets: [KJ_SIGNING_KEY], region: REGION }, async (req) => {
  const auth = req.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const slug = String((req.data && req.data.slug) || "").trim();
  if (!slug) throw new HttpsError("invalid-argument", "Missing slug.");
  const claim = await db.collection("listingClaims").doc(slug).get();
  if (!claim.exists || claim.data().ownerUid !== auth.uid) {
    throw new HttpsError("permission-denied", "You don't own this listing.");
  }
  const token = lsExpToken("edit|" + slug, 1, KJ_SIGNING_KEY.value());
  return { slug, token };
});
