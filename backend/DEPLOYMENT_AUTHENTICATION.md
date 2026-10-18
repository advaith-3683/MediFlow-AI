# Email/password deployment authentication

## Current policy

Signup and login require no mail provider, custom domain, or OTP. Signup returns `{message, token, user}` and the UI opens the patient dashboard or doctor pending screen. Public signup accepts only patient and doctor roles, rejects duplicate emails, hashes passwords, and ignores caller-supplied verification/approval flags. Passwords must have at least 8 characters and at most 72 UTF-8 bytes (bcrypt's input limit).

`User.isVerified` remains the existing **email ownership** field, default false; it is not account authentication or professional approval. The login/signup/session API exposes the explicit alias `emailVerified` as well as legacy `isVerified`. No migration or mass update is required. Previously verified accounts keep their flags and can log in. Older unverified accounts can log in using their original password; signup cannot overwrite them. Existing legacy flags are retained, not independently reverified.

JWT authentication checks the current database account, disabled status, role, and session version. Protected patient routes retain role and ownership checks. Doctor routes, discovery, booking and transactional completion require professional admin approval regardless of email ownership. Explicit pending/rejected status cannot be overridden by the legacy approval boolean. New doctors remain pending, cannot self-approve, and cannot access clinical data. Real availability, demo exclusions, appointment ownership, clinical completion validation and transactions remain in place. Active admins receive admin notifications without email OTP being required.

The frontend no longer requires `isVerified` to accept a signed-in session. It still restores identity from the server, refreshes approval on focus/every 30 seconds, and guards professional approval. Signup does not visit `/otp`. The optional OTP page remains available for a future opt-in verification workflow; no verification step is mandatory.

## Optional email and recovery

`AUTH_EMAIL_ENABLED` defaults to disabled unless its value is exactly `true`. All four endpoints (`resend-otp`, `verify-otp`, `forgot-password`, `reset-password`) return `503 EMAIL_FEATURE_DISABLED` while disabled, before account access or writes. The Resend adapter, hashed OTP storage, expiry, atomic consumption, cooldown, attempt limits and reset-driven session revocation are retained.

To enable optional verification/recovery later, configure `AUTH_EMAIL_ENABLED=true`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM` securely, then restart. Delivery still requires a provider-supported sender. Enabling the feature alone is insufficient: sending without provider configuration returns `EMAIL_NOT_CONFIGURED`. Signup/login never call email even when the flag is enabled.

Without email delivery there is **no self-service password recovery**. The existing Forgot Password page displays the server's unavailable message; it does not advance on failure. There are no reset links, guessed tokens, security questions, password disclosure, or public admin-reset endpoint. Do not promise recovery through ordinary email support without a separately designed identity-verification process. Optional OTP reset can operate for unverified-email accounts, proves access through the delivered code, and does not falsely change their email verification flag.

The existing `.env` was not edited. `.env.example` documents the disabled default and optional settings. No emails were sent, databases connected/mutated, bootstrap run, or destructive integration tests executed during this task.

## Administrator bootstrap

Bootstrap is explicit; application startup and public signup never create an admin. It supports an empty development database and can be explicitly used for a deployment database. Run **one bootstrap process at a time**. It refuses to elevate an existing patient/doctor email or create a different admin when an admin already exists. Rerunning with the existing admin email does not change its password, disabled state, or verification status.

1. Select the intended database deliberately. Supply `MONGO_URI`, `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PHONE` (10–15 digits) and `ADMIN_PASSWORD` through a secure process environment or hosting secret manager. Use a unique password of at least 12 characters, at most 72 UTF-8 bytes. Do not put secrets in shell history or commit them. Legacy `DEMO_ADMIN_EMAIL/PASSWORD/NAME` inputs are accepted for compatibility; `ADMIN_PHONE` is still required. No phone/name/password is fabricated.
2. From `backend`, invoke:

```text
npm.cmd run bootstrap:admin -- --confirm-bootstrap
```

3. This explicitly creates a real admin record and initializes normal User indexes. It is a database-mutating operation: run it yourself only after selecting/approving the intended database. New admin email ownership remains false. There is no emailed OTP requirement.
4. Sign in using those credentials. Remove bootstrap-only password variables from the runtime environment afterward. Do not use the bootstrap command as a password reset mechanism. Omission of `--confirm-bootstrap` fails before reading `.env` or connecting.

## Safe validation results

Safe backend tests use mocked Mongoose operations, real schema validation/bcrypt/JWT, and local HTTP. They do not connect to MongoDB or providers. Coverage includes patient signup/login, new-doctor pending state, actual admin approval route and refreshed access, rejection, wrong passwords, missing/invalid JWTs, disabled accounts, duplicate signup, public admin-role rejection, existing verified accounts, optional mail disabled/unconfigured, unverified account recovery, discovery and clinical completion without email verification, and bootstrap empty/conflict/idempotency behavior.

Selected command from `backend`:

```text
node --test tests/deploymentAuth.test.js tests/authSecurity.test.js tests/recommendationRoutes.test.js tests/recommendations.test.js tests/transactionSafety.test.js tests/consultationCompletion.test.js tests/doctorClinicalAuthorization.test.js tests/doctorAppointments.test.js tests/adminSafety.test.js tests/appointmentDomain.test.js tests/clinicalDomain.test.js
```

Do not run the legacy destructive `http.integration.test.js` or broad `npm test` against a real database. That integration suite still assumes mandatory OTP responses and is not a deployment verification.

Results: 191 backend tests passed, zero failures; 3 frontend state tests passed. `npm.cmd run build` (TypeScript and Vite), frontend lint, and backend syntax checks passed. Targeted backend lint had no errors; six warnings concern existing/test thenables, an existing unused import, and regex style. Real empty-database bootstrap, browser flow, MongoDB concurrency and optional inbox delivery remain unverified.

## Manual acceptance steps

Use an explicitly approved disposable application database and synthetic accounts; the following steps write data. This task did not run them on your real database.

1. Restart backend/frontend with mail unconfigured and `AUTH_EMAIL_ENABLED` unset/false. Register a patient. Expect a session and dashboard, no OTP page, and `emailVerified:false` in the session response/database's `isVerified:false`. Sign out and sign in with the same password.
2. Attempt an incorrect password (401), duplicate signup (409), public admin signup (400), and protected API without JWT (401). Verify the original account's credentials remain unchanged.
3. Register a doctor with valid professional details. Expect pending review and no clinical/appointment access (403). Setting approval flags in signup must not alter this.
4. Bootstrap a disposable admin explicitly as above, sign in, and approve that doctor in Admin Portal. Focus the doctor's tab or wait up to 30 seconds. Expect dashboard access without email OTP. Publish genuine test availability only in this disposable environment.
5. As that doctor, confirm only assigned patient appointments/clinical records can be accessed. As the patient, confirm another patient's records are inaccessible. Repeat the existing appointment → consultation → prescription acceptance flow in the disposable environment.
6. Reject/disable the disposable doctor; existing tokens must lose clinical access. Disabled patient/admin tokens must also fail. Existing verified-email accounts should still log in without state changes.
7. Click Forgot Password with email disabled. Expect a clear unavailable error and no generated-code success. Optional recovery need not be enabled for deployment.

## Deployment risks and next task

Email addresses are identifiers, not proof of ownership. Users can mistype or register an address they do not own; do not treat it as a verified contact channel. Recovery remains unavailable by default. Keep HTTPS, a strong JWT secret, restricted CORS, and database access controls. Existing local-storage JWT exposure to XSS, client-only logout, seven-day token lifetime, per-process rate limiting, and optional email's cross-service delivery limits remain as documented in `AUTHENTICATION_SECURITY.md`. Password reset still revokes existing JWTs atomically when optional recovery is enabled.

Next task: run these deployment acceptance steps against an approved disposable database, starting with empty-database bootstrap and patient/doctor/admin role transitions, then the full appointment → consultation → prescription workflow. Do not substitute live production record changes for this verification.

## Modified file inventory

- Backend: `routes/{auth,ai,admin,appointments,doctorAppointments,doctorClinical,medicalRecords,patientClinical,notifications}.js`; `models/User.js`; `services/{authSecurity,emailService,consultationCompletion,doctorRecommendations,notificationService}.js`; new `services/adminBootstrap.js`; `createAdmin.js`; `package.json`; `.env.example`.
- Frontend: `src/auth/{AuthContext.tsx,types.ts}`; `src/pages/auth/SignupPage.tsx`; `src/pages/doctor/DoctorPendingPage.tsx`; email-verification labels in `src/pages/admin/AdminUsersPage.tsx`; regenerated `dist/`.
- Tests: new `tests/deploymentAuth.test.js`; updated `tests/{authSecurity,doctorAppointments,doctorClinicalAuthorization,recommendations,recommendationRoutes,consultationCompletion,adminSafety}.test.js`.
- Documentation: this file and the supersession notice in `AUTHENTICATION_SECURITY.md`.
