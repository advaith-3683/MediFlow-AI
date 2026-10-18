# Phase 3: appointment concurrency and clinical safety

Status: implemented and safely regression-tested; **real MongoDB concurrency, rollback and browser acceptance are not verified**. Phase 3 requires review and disposable integration verification before Phase 4. No application `.env` was opened/changed, no production database was connected, and no records were seeded/modified for this work.

## Defects identified

- Interval collision reads and appointment writes were separate operations. Partial unique indexes only covered identical doctor/patient start times; they were not an interval exclusion constraint. Different-start patient overlaps across doctors, existing longer appointments, and concurrent rescheduling were vulnerable to write skew.
- Availability checks, profile schedule writes and booking were not serialized. A booking could commit between availability inspection and update.
- Doctor cancellation did not increment appointment `__v`, allowing stale patient/admin saves to miss the change. Patient/admin cancellation and rescheduling did not require the version displayed to the caller.
- JavaScript date parsing accepted numbers, local timestamps, normalized impossible dates, and seconds/milliseconds. Availability membership ignored subminute values.
- Legacy date/time appointments were omitted from discovery's bounded `startAt` queries. Unparseable scheduled legacy entries could be silently ignored.
- Draft save checked neither appointment state nor appointment version atomically with note/audit writes. Completion used transactions correctly but did not reject a clinician's stale appointment version. Completed appointment context was rejected, breaking the existing View completed link.
- Prescription voids and amendments persisted their clinical record, audit and notification separately. Concurrent voids could emit duplicate events. A cancelled-only appointment also counted as a clinical relationship for medical-file access.
- Backend CORS omitted PUT although draft saving uses PUT.

## Consistency strategy

`services/scheduling.js` uses Mongoose `withTransaction`, snapshot reads, majority writes, and primary reads. Every participating database operation receives the same session. Each booking and reschedule first **writes** the doctor's and patient's existing User documents (`$inc schedulingVersion`). Availability changes write that same doctor document. These per-account writes force a MongoDB write conflict between competing transactions sharing a doctor or patient; the driver retries the entire callback against a fresh snapshot, including authorization, schedule and interval checks. An application mutex or snapshot read by itself would not prevent write skew.

No reservation collection or minute-bucket backfill is needed. Existing appointments participate immediately. Collision checks inspect all scheduled appointments for the doctor OR patient, exclude the rescheduled record, convert known legacy dates, and compare half-open intervals `[start, end)`. Adjacent appointments are allowed; different-start overlaps are not. Unknown scheduled dates fail closed with `LEGACY_SCHEDULE_REVIEW_REQUIRED`, requiring deliberate operator review rather than fabricated times or silent data mutation. Discovery/slot reads include legacy records and suppress slots conservatively when dates are unknown. Reschedule slot retrieval can exclude only the authenticated patient's own scheduled appointment with that same doctor. Slot responses are advisory; the transaction always validates again.

Appointment changes write status/version predicates and increment `__v`. Cancellation releases the interval by changing status to cancelled; nothing is deleted. Cancellation/completion/draft/reschedule conflicts on the appointment document either retry or reject the stale version. Once any consultation record exists, rescheduling is blocked so clinical notes cannot silently move to another time. Availability changes preserve bookings; the existing explicit `confirmConflicts` workflow remains, with conflict counts retained. A changed schedule affects future reservations, not previously committed appointments.

All scheduling audits and in-app notifications are transaction writes. There is no external email/network delivery in callbacks and no swallowed post-commit database write. Prescription voiding and amendment insertion now use the same transactional wrapper; identical concurrent voids return the existing voided record without duplicate audit/notification records. Amendments append under the doctor write guard and keep original notes/history. Amendment calls represent separate additions; after commit uncertainty reload history instead of blindly resending an amendment.

Standalone MongoDB transaction rejection fails closed with `503 TRANSACTIONS_REQUIRED`. There is no unsafe fallback. Unknown commit acknowledgement yields `SCHEDULING_OUTCOME_UNKNOWN`; booking can be retried identically, while uncertain draft/amendment results require reloading the record. No rollback path deletes committed records.

### Scope and limits of the guarantee

The guarantee applies to application writers using this service. Direct database writes, old deployed instances and maintenance scripts can bypass it. Stop/drain older writers during deployment and do not run migrations/seeds concurrently. Existing overlaps are rejected on further conflicting writes, not repaired. Locks serialize a doctor's scheduling operations across all dates, a deliberate modest-clinic tradeoff; long scheduled backlogs may make interval scans expensive. This is not a database-wide interval constraint against arbitrary clients.

All instances must use the same `CLINIC_TIMEZONE_OFFSET` (default +05:30). Inputs are minute-aligned canonical UTC strings exactly as returned by slots, e.g. `2035-01-01T03:30:00.000Z`. Stored doctor IANA timezone metadata does not select separate scheduling zones. Multi-zone/DST scheduling is not implemented. Offset validation now bounds minutes and magnitude; changing the clinic offset for existing schedules requires deliberate planning.

## Booking idempotency

The frontend sends a random `requestId`, retained across retries of an unchanged booking within that page. The backend hashes patient ID plus request ID to a deterministic ObjectId and stores a private normalized request hash. The built-in unique `_id` index arbitrates concurrent duplicate inserts; a fresh transaction retries duplicate-key conflicts once and reads the receipt. Matching payload returns the same appointment with no duplicate events; a reused key with changed payload returns 409. Requests without a key use a normalized-payload fingerprint for compatibility.

There is no new unique index requirement for receipts. The original partial unique start-time indexes are retained as additional protection, not represented as overlap prevention. Deterministic IDs use 96 bits of SHA-256; theoretical collisions fail closed rather than overwriting appointments. Records are retained as receipts even after cancellation/completion/rescheduling. Intentional rebooking after cancellation needs a **new** request ID; it never resurrects a cancelled receipt. After a browser reload the caller must retain its original request ID to recover that precise receipt; interval protection still prevents a second overlapping reservation with another key. Do not delete appointment records to clear idempotency state.

## API/client changes

- POST appointment response shape is preserved. Initial success is 201; identical replay is 200. `requestId` is optional, 16–128 URL-safe alphanumeric/underscore/hyphen characters.
- Patient reschedule/cancel, doctor cancel and admin cancel require `appointmentVersion` equal to the displayed appointment `__v` (missing legacy `__v` is zero). Missing versions return 400; stale versions return 409. Identical reschedule/cancel retries may return the already committed result without new events.
- Draft PUT requires `appointmentVersion` and returns the new version. The clinical client updates its local version after saving. Completion requires the loaded appointment version on a new completion; existing committed identical receipts remain replayable. Backend/frontend must be deployed together and old tabs refreshed.
- Patient booking/rescheduling/cancellation, admin cancellation and clinical workspace calls have been updated. There is no UI redesign. Completed clinical context remains read-only in the existing workspace. Cancelled context is rejected, and only scheduled/completed relationships grant medical-file access.

## Clinical completion findings

The pre-existing completion transaction was retained: consultation, prescription, appointment status, audit records and durable in-app notification use one session, all candidates validate before writes, callback retries reload documents, duplicate-key conflicts reread in a fresh transaction, and identical committed receipts do not duplicate prescriptions/events. Existing notes, amendments and voided history remain intact. A new version check rejects clinical operations from stale screens before any new clinical writes. Cancellation and completion both write the same appointment; they cannot both commit from the same version. Read access to legitimate completed history is restored.

This is code review and mocked regression evidence. The real deployment's transactions, indexes, permissions and failure behavior remain unverified.

## Verification

235 safe backend tests passed, zero failures. This includes 38 additional regression cases covering same-slot contention, different-start overlaps, patient contention across doctors, duplicate/conflicting request IDs, concurrent reschedules, cancellation races, release after cancellation, rollback at appointment/audit/notification writes, stale drafts/completion, authorization, invalid timestamps, schedule boundaries, legacy dates, unsupported transactions, uncertain commit replay, voiding and amendments. Earlier completion rollback/idempotency and authentication/security suites were rerun. Three frontend state tests passed; TypeScript/Vite production build and frontend lint passed. Modified backend JavaScript and prepared integration modules passed syntax checks; targeted lint found no errors (remaining warnings concern test thenables, existing regex style, and existing unused variables).

Mock snapshot/write-set tests deliberately allow independent documents to commit concurrently: they require the shared doctor/patient writes to detect the conflict. They enforce session presence and validate real Mongoose schemas, but do **not** verify MongoDB's transaction implementation, real retries, storage engine behavior, or actual network uncertainty.

Safe command from backend (never the destructive wildcard suite):

```text
node --test tests/scheduling.test.js tests/secretProtection.test.js tests/deploymentAuth.test.js tests/authSecurity.test.js tests/recommendationRoutes.test.js tests/recommendations.test.js tests/transactionSafety.test.js tests/consultationCompletion.test.js tests/doctorClinicalAuthorization.test.js tests/doctorAppointments.test.js tests/adminSafety.test.js tests/appointmentDomain.test.js tests/clinicalDomain.test.js
```

## Disposable integration: approval required before mutation

The existing harness remains fail-closed. `tests/transactions/scheduling.cjs` adds 12 real-operation scenarios; `suite.cjs` binds both services to isolated connections after its original checks. No Mongoose methods are mocked there. It verifies same-slot contention, different-start patient and doctor overlap, duplicate bookings, concurrent rescheduling, cancellation races, real notification-write rollback, schedule races, stale draft rejection, unsupported transactions and uncertain booking commit acknowledgement. Existing completion/index/rollback scenarios remain.

Only the offline configuration check was run: `Configuration valid. No connection attempted; no integration tests run.`

Follow [tests/transactions/README.md](tests/transactions/README.md) for exact provisioning commands. Approval must identify **two newly provisioned dedicated local MongoDB 8 servers** at 127.0.0.1:27117 (replica set `mediflow_tx_rs`) and :27118 (standalone), no application/Atlas mounts or port forwarding, nonce-specific allowlisted databases with pristine one-use markers, and permission to create synthetic records/indexes, set scoped validators and app-scoped failpoints on those disposable servers. Keep `MONGO_URI` and `.env` untouched. Do not use a shared local server or Atlas database.

Only after that confirmation, set `confirmedDisposable:true` in the test-only JSON and invoke:

```text
npm.cmd run test:transactions -- --config tests/transactions/disposable.local.json --confirm-disposable
```

The harness contains no broad data deletion and retains synthetic records for inspection. It rejects used fixtures. Do not run `tests/http.integration.test.js` or `npm test`; that older suite can drop a database.

## Manual acceptance after approved disposable setup

1. Start the application against an explicitly approved disposable replica set; use synthetic patient/doctor accounts. Have an admin approve doctors and publish genuine test hours through the existing portal. Do not seed fake doctors into the real application.
2. Two patient sessions submit the same slot simultaneously: one reservation wins, the other receives a conflict. Send the identical booking request/key again: same appointment, no extra events. Reuse the key with different data: 409.
3. With two approved doctors whose valid slot grids are offset (e.g. 09:00 versus 09:15), race overlapping bookings from one patient. Verify one winner. Retain an earlier 60-minute booking, explicitly change the future grid to 30 minutes, and confirm 09:30 is blocked by the earlier 09:00 booking.
4. Race reschedules toward the same interval and cancel versus reschedule. A stale version must fail; reload the appointment. Cancel and confirm another patient can book the released interval while cancelled history stays visible.
5. Open two clinical tabs. Save a draft in one; saving/completing from the stale other tab must return 409. Rescheduling an appointment with notes must fail. Race cancellation against completion: either cancelled with no new clinical completion writes, or completed with one prescription/event set.
6. Change availability during booking. Without explicit conflict confirmation, one operation must reject. With confirmation, existing appointments remain scheduled. Check blocked dates, closing-time boundaries and the exact returned UTC timestamps.
7. Complete, reopen history, verify patient prescription visibility, retry identical completion, void a prescription twice and verify one void event, then append separate amendments and confirm original notes remain. Unrelated/pending/rejected/disabled accounts must remain denied.

## Files modified

- Models: `models/User.js`, `models/Appointment.js`.
- Services: new `services/scheduling.js`; `services/appointmentDomain.js`, `appointmentSlots.js`, `doctorRecommendations.js`, `clinicalDomain.js`, `consultationCompletion.js`.
- Routes/server: `routes/appointments.js`, `doctorAppointments.js`, `doctorClinical.js`, `admin.js`; `server.js` (PUT CORS).
- Frontend: `src/pages/patient/AppointmentsPage.tsx`, `src/pages/doctor/ConsultationWorkspacePage.tsx`, `src/pages/admin/AdminAppointmentsPage.tsx`; regenerated ignored `dist/`.
- Safe tests: new `tests/scheduling.test.js`, `tests/helpers/schedulingHarness.cjs`; updated `tests/doctorAppointments.test.js`, `recommendationRoutes.test.js`, `consultationCompletion.test.js`, `clinicalDomain.test.js`.
- Disposable harness/docs: new `tests/transactions/scheduling.cjs`; updated `tests/transactions/suite.cjs`, `README.md`; this document and `TRANSACTION_COMPLETION.md` phase notice.

Exact next task: review these Phase 3 changes, approve/provision the dedicated disposable environment, and run the real scheduling/clinical integration and manual acceptance checks above. Phase 4 remains out of scope.
