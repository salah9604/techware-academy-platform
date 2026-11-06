# Techware Waiting List

Internal-only registration follow-up dashboard in the academy portal.

## URL
`https://techware-academy-platform.vercel.app/waiting-list`

## Data flow
- The current public website registration page posts to a Google Apps Script endpoint; its final storage destination was not confirmed from repository code.
- The dashboard reads only these seven allowlisted **root Firestore collections** from project `techware-instructor`: `registrationForms`, `formSubmissions`, `courseRegistrations`, `registrations`, `enrollments`, `forms`, and `waitingListSubmissions`.
- Firebase form records are read-only, never deleted or modified by the dashboard.
- Staff decisions are stored under `academyWaitingList/techware/decisions/{source}__{id}`.
- Staff grants are stored under `academyWaitingList/techware/staff/{firebaseUid}`, admin-managed and revocable.
- Each record uses its original form date (`createdAt`, `submittedAt`, `timestamp`, `form_started_at`, etc.). If no reliable date exists, the record is retained for manual review rather than deleted blindly.
- After three **calendar** months the form is automatically excluded from the active waiting list, but remains in the full archive. This is a computed expiry; it does not physically erase the original submission and does not require a cron job.

## Required one-time activation
1. Review and deploy `firebase/firestore.rules` to `techware-instructor`. The repository's existing workflow is **manual** and backs up active rules before deployment: GitHub Actions > `Deploy Techware Firestore Rules` > Run workflow, confirm `techware-instructor`.
2. Verify the exact Firestore collection(s) holding the website's form submissions. If they are stored only in Google Sheets / Apps Script, a secure server-side sync to Firestore must be set up before the dashboard will show them. Do not publish API credentials or connect unprotected sheets directly to the browser.
3. Log in using an existing portal admin account, open `إدارة حسابات السكرتارية`, and add the staff member's Firebase Authentication UID.

## Permissions
Portal admins and legacy admins may read the waitlist and grant/revoke staff. A staff member may only view allowlisted registration submissions and record follow-up statuses. Other users cannot access this data. The client-side gate is UX only: real authorization is enforced in Firestore security rules.

## Checks before handover
- Admin login, secretary login, and unauthorized-user denial.
- Recent three-month cutoff and complete archive with no date fallback bugs.
- Mark attended, remove from waiting, restore; verify persisted status on a second device.
- Test records with no registration date and duplicate student names.
- Verify the actual form submission source and successful rule deployment.
