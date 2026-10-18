# MediFlow AI demo runbook

## Before presenting

1. Follow [DEPLOYMENT_READINESS_REPORT.md](DEPLOYMENT_READINESS_REPORT.md). Use only an owner-approved synthetic demo database, never genuine patient records. Public database contents have not been verified by this audit.
2. Use normal email/password authentication. Optional email verification and recovery are unavailable with `AUTH_EMAIL_ENABLED=false`; no OTP bypass or hardcoded credentials exist.
3. Keep the administrator account private. Bootstrap is explicit and owner-operated; never publish admin credentials or run development doctor seeds in production.
4. Doctor signup remains pending until private administrator review. Configure an approved synthetic demonstration clinician through the existing workflow, only after owner approval of database writes. Development `isDemo` doctor seeds are intentionally excluded from discovery.
5. On Render Free set `MEDICAL_UPLOADS_ENABLED=false`; demonstrate text records only. Do not promise binary-file persistence.
6. Warm `/api/health` before presenting and wait for database-connected status; free-tier cold starts may delay the first request. Do not repeatedly submit booking/completion while a response is uncertain.

## Recommended 3–5 minute sequence

1. Patient (60 seconds): log in, show dashboard counts and safety/privacy labeling, ask the AI triage assistant a mild fictional symptom, then book a recommended verified doctor.
2. Doctor (75 seconds): show assigned appointment context and relationship-protected records, save structured notes, show documentation-only AI assistance, complete the consultation, and explicitly issue a simple pre-reviewed demo prescription only if appropriate for the presentation dataset.
3. Patient outcome (45 seconds): refresh notifications, open consultation history, and print the clearly labeled prescription. Show that original clinical history is read-only.
4. Admin (60 seconds): show live metrics, paginate/filter users and appointments, review a pending doctor’s submitted professional data, and demonstrate confirmation plus audited approval/rejection.
5. Safety close (30 seconds): show emergency triage guidance, private file access, account disabling enforcement, and explain that AI is assistive—not diagnostic or autonomous.

## Manual smoke checklist

- Email/password signup, login and logout. Optional verification/recovery must clearly report disabled when email is off; test actual delivery only after separate approval.
- Patient appointment booking, collision rejection, reschedule, cancel, dashboard aggregates.
- Text medical record validation, filters, ownership and empty states. Confirm binary upload is disabled in both UI and API on Render Free; file-enabled checks require separate persistent storage approval.
- Safety profile, AI language preference, AI outage fallback, emergency warning.
- Doctor pending/rejected page; verified-doctor dashboard, queue, availability, and profile.
- Unrelated appointment/record access returns 403/404 without leaking data.
- Consultation draft, safety warning, completion confirmation, amendment history, prescription void reason, print layout.
- Admin user filters/pagination/status confirmation; doctor decision reason/notification/audit; appointment filters/pagination/cancellation.
- Notification unread badges, mark one read, mark all read, and empty state for every role.
- Unknown route shows 404; forced render failure shows the error boundary.
- Keyboard-only navigation, focus visibility, dialog focus, mobile/table overflow, tablet and desktop layouts.
