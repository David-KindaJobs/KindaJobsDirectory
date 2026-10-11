/*  One-off: grant admin to a user so the pro app can route them to the admin tools.
 *  The user must have SIGNED IN at least once (so their Firebase Auth account exists).
 *
 *  Run locally with a service-account key (Project settings -> Service accounts -> Generate new private key):
 *    GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/seed-admin.js you@example.com
 *
 *  Routing reads accounts/{uid}.role; authorization (in rules) reads the admin:true CUSTOM CLAIM. We set both.
 */
const admin = require("firebase-admin");
admin.initializeApp();

(async () => {
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (!email) {
    console.error("Usage: GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/seed-admin.js <email>");
    process.exit(1);
  }
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  await admin.firestore().collection("accounts").doc(user.uid).set(
    { email, role: "admin", accountStatus: "active", createdAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  console.log("Granted admin to " + email + " (uid " + user.uid + ").");
  console.log("They must sign OUT and back IN for the admin claim to take effect.");
  process.exit(0);
})().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
