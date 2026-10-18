# Phase 5 — Gemini reliability, safety and backend protection

## Audit and preserved behavior

Inspected backend/services/{aiService,triageService,doctorRecommendations,specialties,appointmentSlots,appointmentDomain}.js, routes/{ai,doctorClinical,appointments}.js, server.js, authentication/role middleware, central error handling, existing recommendation/authorization/privacy tests, frontend API client and patient chat/booking and doctor workspace interactions. No existing .env or live database was read. No Gemini request was sent.

Already working, confirmed through source and safe mocked tests: canonical specialty schema and runtime validation, rejection of extra/invented fields, concern-specific provider inputs, strict doctor approval/activity/demo/specialty filters, actual-slot discovery over 14 days with patient conflicts, honest empty results, manual specialty discovery independent of AI, patient/approved-doctor authorization, no AI tools or direct clinical writes, backend-only provider key, redacted errors, React text rendering, and stale recommendation/slot response protection. Different symptom fixtures test routing contracts, not live model accuracy.

## Defects fixed

- Patient chat/triage and doctor assistance now share an authenticated limit of 20 requests/user/15 minutes, with standard rate-limit headers and 429 responses. One in-flight AI operation per user is allowed; simultaneous duplicate or different requests return 409 AI_REQUEST_IN_PROGRESS. The guard remains active during server work after a client disconnect and releases in finally, including errors. No prompt/result cache retains medical text. Successful later retries generate a new response; they are not durable idempotency receipts.
- Provider transport now caps simultaneous calls at four per backend process (429 AI_BUSY when full), response bytes at 256 KiB, output tokens at 4096, and prompt/output text at 12000 characters. It uses a 15-second Axios timeout plus an abort deadline, disables redirects, rejects empty/oversized/incomplete/blocked/nontext responses, joins visible multipart text, and excludes thought parts. Oversized text is rejected rather than silently truncated. Input types, length and control characters are validated; existing limits remain 2000 for triage, 4000 for chat, 6000 for doctor notes.
- No automatic provider retries occur, including timeouts, quota and transport errors: an uncertain charged request is not multiplied. A later explicit user retry is permitted within the request budget. Errors remain generic 503 without provider body, credentials or medical payloads. This is deliberate retry behavior, not guaranteed provider availability.
- Chat and clinical assistance now use separate systemInstruction and user content fields, as triage already did. Shared instructions prohibit claiming professional status, definitive diagnoses, prescription/dose generation, invented records and following instructions embedded in input. Doctor assistance receives only the explicitly submitted notes; no account, appointment, record history or extra request fields are added. Nothing is automatically saved as clinical documentation.
- A conservative local phrase guard escalates chest pain/pressure, severe breathing difficulty, certain stroke warning phrases, unresponsiveness, uncontrolled bleeding and overdose, plus a small Hindi/Telugu phrase set, without provider calls or database discovery. Matched emergency routes bypass AI quota/in-flight restrictions only because they return fixed guidance. Other body fields cannot trigger this exemption. Gemini can additionally escalate other concerns. Emergency responses never offer routine doctors/specialties.
- Triage JSON continues strict runtime validation and adds provider-side string bounds. Obvious unsafe claims/dose instructions and control characters are rejected from visible guidance. Chat has server-supplied AI/disclaimer text. Doctor cards still come exclusively from the database; AI never provides their profiles, fees, credentials or slots.
- Gemini is now optional for backend startup: MONGO_URI and JWT_SECRET remain required; GEMINI_API_KEY is required only for provider-backed features. An absent provider returns 503 for non-emergency AI requests while manual discovery and other application features remain usable. The existing environment file was not changed.
- Frontend labels distinguish local safety guidance from AI guidance, and chat/doctor assistance remind users to omit identifiers. No UI redesign or clinical workflow rewrite was made.

Official references checked: [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output) and [GenerateContent response contract](https://ai.google.dev/api/generate-content). Conservative escalation categories were informed by [NHS heart-attack warnings](https://www.nhs.uk/conditions/heart-attack/) and [stroke warnings](https://www.nhs.uk/conditions/stroke/symptoms/). Local emergency numbers are not assumed or hardcoded.

## Files modified

- backend/services/aiService.js
- backend/services/triageService.js
- backend/services/aiSafety.js (new)
- backend/middleware/aiProtection.js (new)
- backend/routes/ai.js
- backend/routes/doctorClinical.js (AI assistance only)
- backend/server.js (provider no longer mandatory for startup)
- backend/.env.example (optional provider documentation)
- backend/tests/aiReliability.test.js (new)
- backend/tests/aiProtectionRoutes.test.js (new)
- frontend/src/pages/patient/AIChatPage.tsx
- frontend/src/pages/patient/AppointmentsPage.tsx
- frontend/src/pages/doctor/ConsultationWorkspacePage.tsx
- backend/PHASE5_AI_RELIABILITY.md (this report)

## Verification and boundaries

307 selected safe backend tests passed, zero failed (32 new Phase 5 tests); three frontend tests passed, zero failed. Frontend lint, TypeScript checking and production build passed. Nine changed/new backend JavaScript files passed syntax checks. Targeted backend lint has no errors; server.js has an existing unused catch-parameter warning. Deliberate control-character checks are documented in code.

All new tests use synthetic inputs, mocked Axios responses and mocked account/database methods. HTTP tests use real Express/JWT authorization on loopback. They cover invalid JSON/missing/extra fields, known specialty fixtures, no matching doctors, prompt separation, dangerous output rejection, timeouts/cancellation/quota failures, provider absence, blocked/incomplete/oversized/multipart responses, concurrency cap, duplicate requests, budget isolation, emergency quota bypass, authorization and redaction. No real provider timeout, model classification accuracy, live browser flow, live doctor inventory or MongoDB transaction was verified. No destructive integration suite, database write, seed or external email was run. Prior Phase 3/4 tests remain in the safe selection.

Safe backend command (never substitute npm test, which includes legacy destructive integration tests):

```powershell
node --test tests/scheduling.test.js tests/secretProtection.test.js tests/deploymentAuth.test.js tests/authSecurity.test.js tests/recommendationRoutes.test.js tests/recommendations.test.js tests/transactionSafety.test.js tests/consultationCompletion.test.js tests/doctorClinicalAuthorization.test.js tests/doctorAppointments.test.js tests/adminSafety.test.js tests/appointmentDomain.test.js tests/clinicalDomain.test.js tests/medicalFiles.test.js tests/medicalRecordsRoutes.test.js tests/clinicalHistory.test.js tests/clinicalHistoryRoutes.test.js tests/aiReliability.test.js tests/aiProtectionRoutes.test.js
```

Frontend commands: node --test tests/latestRequest.test.mjs; npm.cmd run lint; npm.cmd run build (includes TypeScript).

## Remaining risks and deployment requirements

Local phrase matching is deliberately conservative: it has false positives (including negated/quoted warnings), misses many emergencies, spelling variants and languages, and is not a clinically validated classifier. Unmatched text is not evidence that a concern is safe. Static emergency guidance remains visible in the UI. Clinical review of the rule set and multilingual coverage is required before relying on it in care delivery.

System instructions and narrow output checks reduce risk but do not prove semantic correctness, eliminate hallucinations, or defeat every prompt injection. Unsafe paraphrases, invented claims in prose and non-English dosing instructions may evade checks. AI remains educational/uncommitted documentation support; qualified clinicians must verify decisions and no AI response can create a doctor, appointment, prescription or clinical record directly. Symptoms and voluntarily submitted notes are still sensitive: reminders and field minimization are not automatic de-identification. Review provider data handling/retention terms before real patient use.

Limits are per process and reset on restart. Multiple backend replicas require a shared quota/in-flight mechanism or an approved gateway policy before these numbers can be treated as deployment-wide guarantees. There is no daily provider spend cap or cross-account abuse prevention; configure provider quotas/billing alerts privately and restrict deployment traffic. No new paid service or dependency was added. Current model availability/quota and real latency require synthetic live acceptance with the owner's approval.

## Manual acceptance — not executed

1. In an approved staging environment, privately configure an existing Gemini key/model. Do not put either secret in VITE variables. Restart without changing application data.
2. Log in as a synthetic patient. Submit separate mild rash, dental and eye concerns. Verify uncertain specialty guidance, database-only approved matching doctors, genuine eligible slots, and an honest empty result where appropriate. Do not book real appointments.
3. Disable provider access in staging and verify manual specialty search still works; ordinary chat/triage reports unavailable. Known emergency text must show fixed emergency guidance without doctor cards. Verify the local label differs from AI guidance.
4. Double-submit while the provider is pending; expect one call and a controlled 409. Exhaust the staging user budget; expect 429 with rate-limit headers, while known emergency text still receives fixed guidance. Client aborts must not permit overlapping provider work.
5. Send synthetic injection text, malformed/long inputs, and known emergency phrases in supported languages. Review responses for uncertainty, no prescriptions or professional impersonation, no invented profiles and no leaked error details. Confirm no AI text was saved to clinical records.
6. Check unauthenticated/wrong-role/disabled requests and pending/rejected doctor assistance are denied. Approved doctor assistance must use only synthetic notes and remain a draft for clinical review.
7. Inspect browser console/network for errors and verify no Gemini key occurs in frontend requests/assets or application logs. Do not paste secrets into reports.

Exact next task: obtain approval for synthetic-only Gemini acceptance in staging and clinical review of emergency/response behavior. In parallel with release preparation, provision and approve the deferred disposable local MongoDB replica set for Phase 3/4 transaction verification. Neither live-provider correctness nor database transaction verification should be claimed from these mocks.
