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

## Data freshness and known limitations
- The source Google Sheet is read only when an administrator triggers **مزامنة مع Google**. **New web registrations do not appear automatically until an admin syncs**; this is a conscious limitation until a secure server-side Google service account or Apps Script sync is configured.
- The attendance/removal status changes made in this site are saved **only in this site's private decision ledger**, not back into the source Google Sheet.
- Entries older than three calendar months are computed as expired in the active waiting list and remain in the complete archive. Original form records are never physically deleted.
- Client stores a short-lived (five-minute) authenticated session snapshot; server functions verify user permissions for every request.
- The administrator should periodically refresh the source roster (e.g., at the beginning of each workday) until automation is provisioned.
- For always-current synchronized registrations, arrange a secure service-account/Apps Script integration with the verified original source. Never publish a service-account secret or make the Sheet public.

## Setup
- Vercel project `techware-waiting-list`, root directory `waiting-list`.
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
