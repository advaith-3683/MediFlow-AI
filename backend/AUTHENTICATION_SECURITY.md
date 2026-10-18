# Authentication delivery and session security

> Deployment policy has changed: mandatory OTP is removed and email features are disabled by default. See [DEPLOYMENT_AUTHENTICATION.md](DEPLOYMENT_AUTHENTICATION.md) for current behavior, configuration, tests and bootstrap instructions. This document describes the earlier mandatory-email implementation and retained optional security mechanisms; its signup, access and recovery prerequisites are superseded.

## Configuration and rollout

The actual `.env` was not read or changed for this task. No real emails or database writes were performed. Configure these server-only values yourself, after approving email delivery:

```dotenv
EMAIL_PROVIDER=resend
RESEND_API_KEY=<sending-only key for your verified domain>
EMAIL_FROM=MediFlow <accounts@your-verified-domain>
```

Use an existing secure `JWT_SECRET`; never put provider keys in `VITE_*` variables. Restart the backend after configuration. Keep secrets out of source control and logs. There is no development OTP response or console fallback, even if an old `DEV_SHOW_OTP` setting remains in your environment.

Resend offers a free transactional tier; check current limits at https://resend.com/pricing before activation. No subscription or paid service was enabled. Create your own account, verify your sending domain with the exact DNS records Resend supplies (SPF and DKIM), and create a sending-only API key. See https://resend.com/docs/dashboard/domains/introduction and https://resend.com/docs/api-reference/emails/send-email . A provider test sender is not a general-purpose verified sender for real users.

Missing/invalid configuration yields `503 EMAIL_NOT_CONFIGURED`. Rejected, timed-out, or malformed provider responses yield `503 EMAIL_DELIVERY_FAILED`, with no raw Axios error logging. Success means `provider-accepted`, not confirmed inbox delivery. Check the provider dashboard for delivery/bounce details. Webhook-based bounce tracking is not implemented.

## Behavior

- Signup stores an unverified account, then reserves and sends a verification code. A failed send can leave the unverified account for retry; it never creates a verified session. Retrying signup for an existing unverified account resends only: it cannot replace its password, identity, role, or professional profile.
- Doctor onboarding validates canonical specialty, qualifications, languages, experience range, and biography. New doctors remain pending. Rejected doctors retain the existing administrator-assisted correction/review workflow; no self-approval or new self-service resubmission flow was introduced.
- Codes are random, HMAC-hashed at rest, expire after five minutes, allow five failed attempts per issuance, and have a 60-second resend cooldown. Conditional MongoDB updates reserve issuance, increment attempts, and consume codes. Password reset updates the password, clears the code, and increments session version in one update.
- An issued code is usable only after provider acceptance and database activation. Delivery/activation failure clears only that pending issuance, retains cooldown, and does not clear a newer code. A process crash can leave a pending issuance unusable until resend; there is no durable email queue or delivery guarantee. Cross-service email/DB operations are not claimed to be atomic.
- Existing pre-rollout codes without delivery state must be reissued. No migration or production record update is needed.
- JWTs include `sessionVersion`. Legacy JWTs and missing database versions count as zero for compatibility; after password reset all prior versions fail authentication. Each request reads current account role, verification, disabled status, and session version. Database lookup outages go through the normal error handler rather than masquerading as invalid tokens.
- `GET /api/auth/session` returns an allowlisted current user view for every verified role, including pending/rejected doctors. It does not extend JWT lifetime. The frontend validates saved tokens at startup and refreshes on focus and every 30 seconds, guarding out-of-order results. Approval redirects pending doctors to their dashboard; revocation redirects to the pending screen. Backend approval restrictions remain immediate on the next protected request.
- Explicit pending/rejected doctor status takes precedence over `isDoctorVerified: true` in appointment routes, clinical routes, transactional completion, discovery, and admin approved filters. The legacy boolean is accepted only when status is absent. Ownership and clinical completion checks remain intact.

## Safe verification

Run only these selected mocked/unit tests from `backend`; they do not load `.env`, connect to MongoDB, or send email:

```text
node --test tests/authSecurity.test.js tests/recommendationRoutes.test.js tests/recommendations.test.js tests/transactionSafety.test.js tests/consultationCompletion.test.js tests/doctorClinicalAuthorization.test.js tests/doctorAppointments.test.js tests/adminSafety.test.js tests/appointmentDomain.test.js tests/clinicalDomain.test.js
```

Do not use the old `http.integration.test.js`: it contains database deletion and assumes the removed development-OTP contract. It was not executed. The existing disposable transaction harness remains separate and gated.

The new auth tests mock MongoDB update predicates and Axios and use local HTTP for route checks. These are regression coverage, not real MongoDB concurrency or inbox verification. No frontend browser automation was performed.

Results for this change: 178 selected backend tests passed, zero failures; 3 frontend state tests passed; production `tsc -b && vite build` and frontend Oxlint passed. All modified backend JavaScript files passed `node --check`. Targeted backend Oxlint reported no errors and three existing test-harness warnings (two intentional thenables and an unused Mongoose import).

## Manual verification after explicit approval

Use a disposable application database and a mailbox you own. Do not use production accounts for reset/revocation tests.

1. Configure the provider yourself and restart. Approve a test email send before submitting signup. Verify provider acceptance and actual receipt; confirm API/logs contain no OTP or credentials.
2. Verify the received signup code once, then retry it: the second attempt must fail. Resend within 60 seconds must be throttled. An expired code, wrong-purpose code, or sixth invalid attempt must fail. Resend after cooldown must supersede the previous code.
3. With the provider misconfigured in a separate test process, signup/resend must return a safe 503 and never claim delivery. Do not change production configuration to simulate failure.
4. Sign in on two sessions, request/reset a password, and confirm both old JWTs return 401. Sign in using the new password; its JWT must work. Reusing the reset code must fail.
5. On a disposable doctor account, verify email, then have an administrator approve/reject it. Focus the patient-data-free pending screen or wait up to 30 seconds: approval status must refresh without re-login. Rejected/pending doctors cannot access clinical routes even with a legacy true boolean.
6. Disable a disposable account: existing sessions must fail; patient, doctor, and admin roles must remain isolated.

## Remaining limits

Real provider acceptance, inbox delivery, MongoDB concurrent update behavior, and browser session refresh need the approved manual/disposable verification above. Password reset cannot recall a request already authorized before reset commits. JWTs remain in local storage and logout is client-side; cookie-based sessions, per-device revocation, MFA, and rotating refresh tokens are outside this targeted change. Existing sessions expire after seven days; `/session` is identity refresh, not a token-refresh endpoint.

Auth rate limiting is still per-process/IP. A shared rate-limit store is needed for multiple backend instances. Forgot-password success remains generic, but provider-failure status/timing may reveal that an account exists; strong indistinguishability requires a queued delivery design. On startup outage the frontend does not trust cached user data; an already authenticated tab retains its last view during transient refresh failure, with the server still enforcing authorization. Use HTTPS in deployment.

## Files audited and modified

Inspected auth routes/middleware, OTP utility, User model, server rate limits/CORS, error handler, doctor appointment/clinical and completion authorization, recommendation approval predicates, admin review workflow, frontend AuthContext/types/API client/protected routing, signup/OTP/reset/pending pages, package manifests, `.env.example`, and related safe tests.

Modified source/config: `routes/auth.js`, `middleware/authMiddleware.js`, `models/User.js`, `utils/otp.js`, `routes/doctorAppointments.js`, `routes/doctorClinical.js`, `services/consultationCompletion.js`, `routes/admin.js`, `.env.example`, `../frontend/src/auth/AuthContext.tsx`, `../frontend/src/routes/ProtectedRoute.tsx`.

Added: `services/emailService.js`, `services/authSecurity.js`, `tests/authSecurity.test.js`, this document. Updated regression tests: `tests/doctorAppointments.test.js`, `tests/doctorClinicalAuthorization.test.js`, `tests/consultationCompletion.test.js`. Frontend build regenerates `../frontend/dist/`.

Next task: approve and execute disposable end-to-end authentication verification with a configured sender, including two-session reset revocation, concurrent OTP requests, and admin approval refresh. Do this before UI polish or broader architecture changes.
