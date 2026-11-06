# Techware Waiting List

Independent internal Vercel site: https://techware-waiting-list.vercel.app

## Simple secretary workflow
1. Administration signs in once and uses **مزامنة مع Google** to populate the private cache from the real Google Sheet ("Techware courses (Responses)", tab "waiting list").
2. The administrator adds the secretary's **Firebase UID** in the **إدارة حسابات السكرتارية** section.
3. The secretary signs in with their existing Firebase account (Google or email/password). There is **no Google Sheets OAuth step for staff**, and no access to the source spreadsheet is needed.
4. Marking attendance/removal updates a private backend decision ledger immediately and survives refreshes.

## Security
- All server API calls require a Firebase Auth ID token verified against Google's public keys (RS256, exact project issuer/audience).
- The backend checks the user's admin role in Firestore using the user's own Firebase token, or checks an admin-maintained staff allowlist stored privately.
- Registration rows and decisions are stored in a **private Vercel Blob store** scoped to this project. No public URL exposes the data. API responses are `Cache-Control: private, no-store`.
- Only admins may refresh the source roster from Google Sheets or grant/revoke staff. Staff may only read the roster and update attendance/removal.
- Private blob updates use ETag conditional writes and retry on collisions to avoid losing concurrent secretary updates.
- Data is never committed into the GitHub repository or included in client bundles.
- Existing academy teaching platform remains separate and unchanged.

## Auto-sync and source consistency
- **Automatic read on access:** An authenticated list request refreshes Google Sheets when the last successful sync is older than 15 minutes, *provided a server-side service account is configured*. This never asks the secretary to link Google.
- **Scheduled safety-net:** Vercel Cron calls `/api/refresh` daily at 04:00 UTC. Its Authorization header must match the secret `CRON_SECRET`, which is configured for Production.
- **Efficient reads:** Each automatic sync performs one Google Sheets range read and saves the roster in private Vercel Blob. Browser session snapshots last five minutes. No per-student reads or background polling by secretaries.
- **Source records remain read-only**; attendance/removal decisions live in the site's private ledger and survive roster refreshes. They are not written back to the Google Sheet.
- Entries older than three calendar months leave the active waiting list but remain in the full archive. No automatic physical deletion.
- Google Sheets failures do not replace the previously synchronized records; admin can see the last successful sync.
- If the credentials below are not configured, automatic syncing is **not active**; the admin-only manual Google authorization remains a fallback.

## One-time permanent Google service account configuration (admin)
1. In Google Cloud Console for project `techware-instructor`, enable Google Sheets API, create a service account dedicated to waiting-list synchronization, then generate a JSON key (or use a managed identity flow if company policy forbids keys). Never commit the key to GitHub or paste it in chat.
2. In the Google Sheet `Techware courses (Responses)`, use Share to add that service account's `client_email` as **Viewer**. Only the `waiting list` tab is read by this app, though spreadsheet-wide Viewer access applies.
3. In Vercel > Project `techware-waiting-list` > Settings > Environment Variables, add `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` as a **Sensitive** variable for Production, with the complete JSON service account key as its value. Redeploy the production project for the new environment variable to take effect.
4. `CRON_SECRET` is already configured and must never be shared. Check the site's admin status banner: **المزامنة التلقائية مفعّلة**. An admin can click `تحديث الآن` for the first load; thereafter requests and cron sync without a Google popup.

## Limits
- Cron is configured once daily to remain compatible with Vercel Hobby limits. During working hours, the first permitted request after the 15-minute data-freshness threshold triggers a refresh automatically. There is no continuous polling when nobody visits the site.
- The source spreadsheet is fetched as a single bounded `A2:L10000` range, and the server protects the previous roster from empty or suspiciously truncated updates.


## Setup
- Vercel project `techware-waiting-list`, root directory `waiting-list`.
- `CRON_SECRET` is configured for production; `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` still requires the one-time administrative key.
- Private Vercel Blob store attached to this project. The `BLOB_READ_WRITE_TOKEN` environment variable must be available to server functions only.
- All `/api/waitlist` requests are authenticated on the server with verified Firebase ID tokens.
- No separate Firebase Firestore security rule deployment is required for the private roster/decision ledger; existing user profile permissions are still used for admin verification.

## Verification checklist
- No-auth API request must fail with 401 (not expose any roster).
- Non-admin/non-staff Firebase account must fail with 403.
- Admin sync returns the expected private student roster.
- Secretary logs in without a Google Sheets popup; marks attended/removes and sees persisted status on another device.
- Revoke staff and verify backend denial on the next request.
- Verify the course form's newly submitted records appear only after the next admin sync.
