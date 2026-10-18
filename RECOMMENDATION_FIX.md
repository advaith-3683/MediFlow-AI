# MediFlow AI recommendation repair

## 1. Confirmed root causes

The code trace was patient `AppointmentsPage.tsx` → `POST /api/ai/triage` →
`aiService.generate()` → specialty normalization → `GET /api/appointments/doctors`
→ availability/selection → appointment POST.

Before this change:

- `appointmentDomain.normalizeSpecialty()` returned General Physician for every
  unrecognized/missing specialty. Dental/eye specialties were absent entirely.
- `routes/ai.js` silently converted invalid/missing priority to NORMAL and missing
  specialty to General Physician; JSON parsing did not validate the response schema.
- The doctors endpoint fetched ALL approved doctors regardless of the requested
  specialty. It only sorted matches first and everyone else alphabetically. When
  there was no match, the same alphabetical first doctor stayed at the top.
- The page did not clear old triage, doctor selection or slots when symptoms
  changed, and had no protection against out-of-order triage/discovery/slot replies.
- AI outage text offered manual selection, but the UI required successful triage
  before exposing doctor selection. Emergency results still exposed booking.
- Signup used free-text specialties while approval used a fixed canonical list.

No hardcoded doctor ID, fixed Gemini response, literal first-doctor assignment,
or transport-error-to-doctor fallback was found in the recommendation flow.
The repeated results have confirmed code-level explanations above, but which
occurred in the user's live session, live provider output, and whether Atlas has
only one eligible doctor were NOT verified. No connection to Atlas was made.

## 2. Files inspected

- Frontend: patient appointments, AI chat, dashboard, records, prescriptions,
  consultation history, profile, safety profile, settings; doctor dashboard,
  appointments, clinical workspace, availability, profile; admin dashboard,
  doctor review, users, appointments, analytics, audit logs and settings; shared
  notifications; signup; landing page; API client, shared UI and Vite/TS config.
- Backend: `routes/ai.js`, `appointments.js`, `auth.js`, `admin.js`,
  `doctorAppointments.js`, `doctorClinical.js`, `patientClinical.js`,
  `medicalRecords.js`, `notifications.js`; `services/aiService.js`,
  `appointmentDomain.js`, `clinicalDomain.js`, `consultationCompletion.js`,
  notification service; User/Appointment/clinical models, error handler,
  `createDoctors.js`, package/test configuration and `.env.example`.
- Existing authorization, appointment, clinical, completion and safety tests.
- Actual `.env` values were not read, printed, copied or changed.

## 3. Files changed

Backend:

```text
backend/.env.example
backend/createDoctors.js
backend/middleware/errorHandler.js
backend/models/User.js
backend/routes/admin.js
backend/routes/ai.js
backend/routes/appointments.js
backend/routes/auth.js
backend/services/aiService.js
backend/services/appointmentDomain.js
backend/services/appointmentSlots.js                 (new)
backend/services/doctorRecommendations.js            (new)
backend/services/specialties.js                      (new)
backend/services/triageService.js                    (new)
backend/tests/recommendationRoutes.test.js           (new)
backend/tests/recommendations.test.js                (new)
```

Frontend:

```text
frontend/src/api/latestRequest.ts                    (new)
frontend/src/pages/admin/AdminDoctorsPage.tsx
frontend/src/pages/auth/SignupPage.tsx
frontend/src/pages/doctor/DoctorDashboardPage.tsx
frontend/src/pages/landing/LandingPage.tsx
frontend/src/pages/patient/AppointmentsPage.tsx
frontend/tests/latestRequest.test.mjs                (new)
```

This report is new. The production build also regenerates `frontend/dist/` and
TypeScript build metadata. No dependencies, production credentials, real data,
transaction-completion logic or prior doctor appointment protections were changed.

## 4. Hardcoded business data discovered

- Landing preview: fictional patient Aanya, Dr. Ananya Rao, a fixed appointment
  time and record/prescription/visit counts of 8/2/4.
- `createDoctors.js`: explicit development seed names, credentials/profile fields,
  fees and recurring schedules. The script already refuses production mode.
- No fixed dashboard statistics, mock histories, fake clinical records, fixed AI
  replies or fallback doctor objects were found in the inspected portal request
  paths. Those paths consume APIs backed by Mongoose queries/aggregations.
- Settings reminder switches are local preferences, not a working reminder
  delivery feature. Read-only admin settings and static educational/UI text are
  not substituted patient/doctor records.

## 5. Removed/corrected data behavior

Removed fictional landing names/time/counts; replaced them with feature links and
sign-in prompts. Removed universal GP/NORMAL triage fallbacks and unrelated doctor
results. Removed a doctor-dashboard claim of zero appointments before data loads.
Admin's 'Completed consultations' metric now counts completed consultations only,
rather than drafts plus completed records.

Development seeds remain confined to their explicit script and now mark records
`isDemo:true`. Discovery, slot retrieval and new booking/rescheduling exclude
marked demo doctors plus the script's recognizable legacy demo email/bio markers.
No existing database records were modified or removed. Historical stored demo
records may still appear in administrative/history data and affect stored totals;
an authorized administrator must review that data. Unknown manually fabricated
records cannot be identified automatically from names alone.

## 6. Actual recommendation algorithm

The actual submitted concern (maximum 2000 characters, aligned with booking) goes
to Gemini as user content, separately from system instructions. A JSON Schema
constrains priority, up to three canonical specialties, summary and guidance.
Server validation additionally rejects invalid JSON, unknown/duplicate specialties,
invalid urgency, missing fields, excess fields, empty text and overlong output.
It never turns invalid output into NORMAL/GP. Emergency output always suppresses
doctor discovery and returns emergency-care guidance.

Non-emergency specialties drive MongoDB doctor and scheduled-appointment queries.
Only those database records populate doctor cards. Gemini receives no doctor
directory and cannot supply doctor IDs, names, fees, qualifications or schedules.
Booking resolves the selected doctor again and derives patient ownership from
authentication and specialty from the doctor record.

The default provider model remains `gemini-2.5-flash`; optional `GEMINI_MODEL` is
documented without changing actual environment configuration. Keys remain backend
only and are sent in the provider header. Provider errors/truncation are honest
failures with manual discovery available, never fabricated recommendations.

Schema parameters were checked against Google's official
[structured-output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en).
String-length limits are enforced locally; the provider schema uses its supported
subset. Structured JSON does not establish medical correctness.

## 7. Filtering and ranking

Required: doctor role, verified account, active account, approved specialty state,
non-demo identity, exact canonical specialty match, and at least one conflict-free
future slot in a stated 14-clinic-day search window. Explicit pending/rejected
status cannot be rescued by an old verification boolean. Truly legacy records
with no status field and `isDoctorVerified:true` remain supported.

Availability combines recurring weekday hours, blocked dates, existing scheduled
doctor appointments and this patient's other scheduled appointments. Discovery
and slot retrieval share slot generation; booking retains collision revalidation.
Ranking is deterministic: AI specialty order, next available eligible slot, name,
then database ID. Fees, ratings or self-editable qualifications do not create
unverified ranking claims. Multiple eligible doctors are returned; one result is
reported as limited inventory, not artificially replaced with another specialty.

No result displays exactly: 'No matching verified doctors are currently available.'
Manual specialty search uses the same filtering and never defaults to another
specialty. Symptoms, doctor/date changes and superseding requests abort/invalidate
older work. No doctor is preselected. Emergency cards hide discovery/booking, and
an explicit emergency-priority booking POST is rejected server-side.

## 8. Safe fixture examples

These are deterministic mocked provider outputs, NOT observed live Gemini
responses, medical diagnoses or claims of clinically validated symptom routing.

| Synthetic concern | Mocked specialty/output |
|---|---|
| Recurring migraine-like headaches without acute warning signs | Neurologist |
| Persistent itchy rash | Dermatologist |
| Knee discomfort after minor injury | Orthopedic |
| Tooth pain | Dentist |
| Eye irritation | Ophthalmologist |
| Ongoing mild stomach discomfort | Gastroenterologist |
| Routine fever without severe symptoms | General Physician |
| Potentially serious chest pain | EMERGENCY; no doctors or booking |
| No matching approved specialist / empty directory | Empty doctors; exact no-match message |
| Provider failure | Honest error; manual specialty search |
| Multiple same-specialty doctors | Multiple real-record fixtures, ordered by actual slot eligibility |

Two concerns can legitimately yield the same specialty and doctor. The system
does not manufacture variety when clinical scope or the actual inventory is limited.

## 9. Verification

- 149 selected backend tests passed, including prior authorization/transaction
  regressions and 39 new recommendation/service/HTTP scenarios.
- 3 frontend latest-request tests passed: input invalidation, out-of-order replies,
  and stale slot rejection.
- Frontend TypeScript application/config checks and Oxlint passed.
- `npm.cmd run build` (TypeScript build and Vite production bundle) passed.
- Changed backend JavaScript syntax checks passed.
- Provider/DB methods in new backend tests are mocked. HTTP middleware and routes
  run on an ephemeral local test server; they do not import application startup.
- No destructive integration suite, MongoDB write, seed, migration or provider
  call using real credentials was executed. Full browser interaction/visual QA
  has not been performed.

## 10. Remaining application issues

Live model classification/safety and real inventory/index/persistence behavior
remain unverified. A clinician should evaluate emergency and specialty guidance;
the assistant is not a diagnosis system. Users can still choose manual discovery
without model triage, so its emergency notice remains important. The server's
explicit emergency-priority block does not independently classify arbitrary
manual booking text or prevent a deliberately forged NORMAL priority.

Availability follows the existing clinic-offset policy and a 14-day search window,
not arbitrary per-doctor regional timezones. Legacy appointments without `startAt`
need the previously documented migration review before collision guarantees cover
them. The pre-existing different-start-time booking concurrency gap remains outside
this recommendation repair. Completion transaction verification is still pending
the separate confirmed disposable environment. Existing OTP delivery and doctor
completed-context limitations are not rebuilt by this task.

## 11. User actions

Restart/reload API and UI to pick up the changes. In a safe test environment, use
real doctor accounts with email verification, administrative approval, canonical
specialties, correct profile attributes and published recurring availability.
Review existing specialty spellings through the admin's new reviewed-specialty
selector. Create appropriate approved dental/eye/other specialist accounts if those
services are offered; no fake accounts were inserted to satisfy the examples.
Disable/review legacy demo accounts rather than using them as actual clinicians.
If no eligible slot exists in the next 14 days, the directory intentionally stays
empty. Verify provider key access/model availability locally without sharing keys.

## 12. Live integration status

Real Gemini: NOT VERIFIED. Real MongoDB/Atlas recommendation inventory: NOT
VERIFIED. No production/development Atlas connection was made, and `.env` and
production credentials remain unchanged. The previous disposable transaction test
gate remains intact; its confirmation was not granted or bypassed in this task.
