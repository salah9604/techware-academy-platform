# Techware Waiting List — standalone site

Independent Vercel project built from this folder only. The main Techware Academy Platform keeps its own build and login.

The public registration form currently sends to Google Apps Script, not directly to Firestore. Confirm the final storage collection or implement server-side sync before expecting real records to show.

Authentication uses the existing Firebase project techware-instructor; the Firebase Auth Authorized Domains must include the independent Vercel hostname for Google popups.

Waiting-list records are read-only; staff decisions live in academyWaitingList/techware/decisions, staff authorizations in academyWaitingList/techware/staff. Firestore rules are shared because both sites intentionally access the same Firebase project and are maintained in ../firebase/firestore.rules (currently require manual deployment).

Three-calendar-month expiry removes records from the active view but retains them in the complete archive.
