# Phase 6 — portals, notifications and administration

## Evidence and status legend

This is a source/contract audit plus safe automated verification, not a claim that all screens were exercised in a browser. Inspected the complete page/route inventory in frontend/src/routes/AppRouter.tsx, Patient/Doctor/Admin/auth/shared pages, portal navigation and notification badge, API client, AuthContext/ProtectedRoute, backend routes, User/Notification/Appointment/Consultation/Prescription/MedicalRecord/AuditLog schemas, notification/admin/scheduling/completion/history services and existing tests. Previous phase reports supply the established clinical/storage/AI constraints.

**Implemented** means the existing UI and backend path are wired, with no missing implementation found within the stated feature scope. It does not mean verified live. **Partial** identifies a specific remaining limitation. **Disabled** identifies deliberate demo/optional-service restrictions. **Nonfunctional** describes an absent execution path, rather than inventing a feature. The last column is an independent release-verification requirement.

## Feature matrix

| Portal/page or feature | Implementation status | Evidence / limits | Real-environment verification |
|---|---|---|---|
| Shared signup/login/logout | Implemented | Email/password, bcrypt/JWT, no mandatory OTP, patient/doctor roles only at signup | Browser/session acceptance |
| Shared session refresh and role guards | Implemented | Server account every request; frontend refresh on focus/30 seconds; current approval/reason, disabled/revoked sessions rejected | Multi-session browser acceptance |
| Optional OTP/password recovery pages | Disabled unless optional email is enabled/configured | Fail closed; no signup dependency; no insecure recovery alternative | Provider verification only if intentionally enabled |
| Patient dashboard | Implemented | Owned database counts/next appointment; excludes pending/deleting medical uploads | Live data/count consistency |
| Patient symptom guidance/chat | Implemented with clinical limitations | Phase 5 validation, limits, local escalation, manual alternative | Approved synthetic Gemini acceptance and clinical review |
| Patient doctor discovery/slots | Implemented | Approved active non-demo matching specialty; genuine eligible slots | Live inventory/availability acceptance |
| Patient booking/history/reschedule/cancel | Implemented | Ownership, versions, transactional reservations/events, request IDs | Real replica-set races/rollback and browser acceptance |
| Patient consultation history | Implemented | Consistently owned completed records; private notes excluded | Synthetic clinical acceptance |
| Patient prescriptions | Implemented | Issued active/voided history, narrative amendments, print view | Browser print/history acceptance |
| Patient medical records | Implemented with storage constraints | Upload/list/view/download/delete; recovery receipts; authorized files | Persistent-volume/restart/backup acceptance |
| Patient profile | Implemented | Owned name/phone updates; email/role not editable here | Browser save/refresh |
| Patient safety profile | Implemented | Owned patient-reported allergies/medications/conditions | Browser save/refresh; not clinician-verified |
| Patient settings | Implemented for account preference persistence | Boolean preferences now stored per account, not shared browser-local flags | Reload/different device acceptance |
| Timed appointment reminders / health-tip delivery | Nonfunctional delivery path; explicitly disabled in demo | No scheduler/publisher exists. Stored opt-ins do not imply messages are being sent; UI states this. Essential care/account in-app events remain enabled | Not required for current demo scope; scheduler would be a separate task |
| Doctor pending/rejected account | Implemented review gating; partial self-service correction | Displays rejection reason and owned notifications; no clinical access; corrected applications still require contacting administrator | Browser review/approval transitions |
| Doctor dashboard/queue | Implemented | Assigned appointment and completed-consultation counts, chronological queue | Live query/timezone acceptance |
| Doctor appointment history/management | Implemented | Assigned-only routes, approved doctor required; generic completion blocked | Browser ownership/state acceptance |
| Doctor consultation workspace/drafts/completion | Implemented | Existing clinical transactions and stale-version guards | Real transaction and browser verification |
| Doctor historical notes/records | Implemented | Authorized relationship, cancelled-only relationship excluded, completed history preserved | Synthetic access tests in staging |
| Doctor prescription amendments/void | Implemented | Original medicines retained; idempotent append-only narrative changes, audit/notifications transactional | Real transaction verification |
| Doctor profile/credentials | Implemented within existing contract | Profile fields editable; specialty/approval controlled by admin; license/facility reviewed at application rather than edited here | Profile validation/credential-review acceptance |
| Doctor availability | Implemented | Published hours, duration, blocked dates; existing-booking conflict handling | Real scheduling races and clinic-timezone acceptance |
| All-role notifications list/read/read-all | Implemented | Recipient scoped, bounded pagination, stable read timestamp, unread count, loading/error/retry states | Event-to-browser propagation |
| All-role notification badge | Implemented polling | Updates on read action/focus and 60-second poll; no WebSocket/push promise | Multi-tab/reconnect acceptance |
| Admin dashboard | Implemented | Database counts/recent audit activity; pending status authoritative, visible medical records | Real aggregate/count verification |
| Admin doctor review | Implemented | Approve/reject/reason/specialty saved with audit and notification in one transaction; same decision no-op | Real transaction/concurrent decision acceptance |
| Admin account management | Implemented within safety restrictions | List/search/filter/detail endpoints; suspension/reactivation; no public admin creation or destructive account deletion | Role/session/browser acceptance |
| Admin appointment oversight | Implemented | Filters/pagination/date range; reasoned scheduled cancellation delegates to Phase 3 transaction | Real cancel-versus-complete verification |
| Admin analytics | Implemented | Database aggregation pipelines and historical prescription count; no invented business statistics | Execute pipelines on approved isolated dataset |
| Admin audit logs | Implemented | Admin-only controlled metadata, filters/pagination/inclusive UTC end date | Synthetic event-to-log acceptance |
| Admin settings | Intentionally read-only | Environment label/admin identity; no browser editing/display of secrets | Deployment config check |
| Landing/auth navigation/not-found | Implemented | Links into actual portals; preview requests sign-in and contains no fabricated doctor/statistic inventory | Browser routing acceptance |

No additional fake doctors, statistics, appointments or clinical records were introduced. Synthetic users and records exist only in test memory.

## Defects repaired

1. Admin decisions previously saved account state, reason, audit and notifications separately; notification failures were swallowed. Decision/reason, audit and in-app notification now commit together using the existing transaction helper. Every participating database operation receives the session. Active administrator and target document writes participate in transaction conflicts. Unsupported transactions fail closed; unknown commit acknowledgement is reported as uncertain.
2. Identical current decisions/status updates are no-ops, including concurrent retries, so they do not duplicate events. This is state-based idempotency: retrying an old decision after an intervening different decision is a new change, not a durable request receipt. Opposing valid admin decisions serialize on the target; the last committed decision wins and each committed transition has its own audit/event.
3. Suspension increments sessionVersion exactly once per actual suspension, atomically. Previous JWTs stay revoked after reactivation; affected users must sign in again. Server-authoritative approval/session refresh was already implemented and was preserved.
4. Notification list access and read/read-all ownership were already implemented. Added older-page navigation, strict integer bounds, stable sort and no-store list responses. Repeated mark-read preserves the first read timestamp; cross-user guesses return 404.
5. Settings were browser-local and not account-specific. Added owned, allowlisted boolean preference endpoints/schema and wired settings to them. Essential booking, clinical and security events cannot be disabled by these optional reminder/tip preferences.
6. Pending/rejected doctors could not reach notification links because the frontend guard redirected every route. They may now access only the pending page and notifications until approved; clinical authorization remains unchanged. Rejection notifications link to the pending page, which now displays the actual reason.
7. Pending dashboard counts incorrectly excluded canonical pending records carrying a contradictory legacy boolean. Canonical status now controls that metric and the doctor-review label. Hidden pending/deleting medical records no longer inflate patient/admin visible-record counts. No live legacy records were repaired or approved.
8. Admin pagination accepted fractional/nonfinite values, and date-only end filters excluded most of the chosen day. Added bounded integers and strict real-calendar dates, inclusive UTC end-of-day, and reversed-range rejection. This does not change clinic slot timezone handling.
9. Notification read errors were unhandled, initial loading looked like an empty inbox, and badge counts lagged after reads. Added caught mutation errors, retry/loading states, periodic/focus refresh and immediate read-change badge refresh. Admin table requests now use the existing latest-request gate, preventing old filter responses from replacing current results; loading/empty/error states are distinct. Dashboard error states no longer leave endless loading skeletons.

## Notification event coverage

| Committed operation | Recipient(s) and notification behavior |
|---|---|
| Booking | Patient APPOINTMENT_BOOKED; assigned doctor NEW_APPOINTMENT; in reservation transaction |
| Rescheduling | Patient and doctor APPOINTMENT_RESCHEDULED; in scheduling transaction |
| Cancellation, including admin cancellation | Patient and doctor APPOINTMENT_CANCELLED; same guarded transaction; cancellation retry does not add events |
| Doctor approval/rejection | Doctor DOCTOR_VERIFICATION; same transaction as decision, legacy flag/reason and audit |
| Suspension/reactivation | Target ACCOUNT_STATUS; same transaction as status/session change and audit. Suspended users cannot read it until reactivated and signed in |
| Completion with prescription | Patient CONSULTATION_COMPLETED explicitly says prescription issued and links to prescriptions; a second redundant prescription notification is unnecessary |
| Completion without prescription | Patient CONSULTATION_COMPLETED links to consultations |
| Prescription amendment/void and consultation amendment | Existing transactional patient notifications retained; retry protections unchanged |

No email, SMS or external delivery is required. In-app records are the durable delivery mechanism. Real-time push, a background reminder scheduler and new-application broadcasts are not claimed as implemented; the admin pending queue already exposes submitted applications. No new paid service or dependency was introduced.

## Files modified

Backend:
- models/User.js
- services/adminActions.js (new)
- services/adminQueries.js (new)
- services/adminDomain.js
- services/scheduling.js (exports existing transaction helper; clinical/scheduling logic unchanged)
- routes/admin.js
- routes/notifications.js
- routes/appointments.js (visible-record metric only)
- tests/portalCompletion.test.js (new)
- tests/portalRoutes.test.js (new)
- tests/deploymentAuth.test.js (approval uses safe transaction harness; unmatched sessions explicitly forbidden)

Frontend:
- auth/types.ts
- routes/ProtectedRoute.tsx
- components/ui/NotificationBadge.tsx
- pages/shared/NotificationsPage.tsx
- pages/patient/SettingsPage.tsx
- pages/patient/DashboardPage.tsx
- pages/doctor/DoctorPendingPage.tsx
- pages/doctor/DoctorDashboardPage.tsx
- pages/admin/AdminDoctorsPage.tsx
- pages/admin/AdminUsersPage.tsx
- pages/admin/AdminAppointmentsPage.tsx
- pages/admin/AdminAuditLogsPage.tsx
- pages/admin/AdminDashboardPage.tsx
- pages/admin/AdminAnalyticsPage.tsx

This report: backend/PHASE6_PORTAL_COMPLETION.md. Existing .env files, dependencies, medical records and database data were not changed.

## Test results and verification limits

**328 selected backend tests passed, zero failed; 3 frontend tests passed, zero failed.** Phase 6 adds 21 backend tests. Backend syntax checks passed for 11 changed/new JavaScript files. Frontend lint, TypeScript and production build passed. Targeted backend lint has no errors and two no-thenable warnings for deliberate query mocks (one pre-existing).

The first broader run found an older approval HTTP test had no transaction mock for the new code path. It was corrected to execute the real admin service against the existing snapshot/write-set harness, and now explicitly rejects unmatched real session creation. Final suite passes. No live database connection was opened; no database-mutating integration tests were run.

New regression coverage includes notification creation/ownership/pagination/read idempotency/preferences/redaction, concurrent approval and rejection retries, admin/audit/notification rollback, suspension/revocation/reactivation, unsupported transactions and uncertain commit retries, cross-role access, database count/aggregate contracts, appointment event propagation, date boundaries, audit visibility and session refresh. Existing completion tests cover combined completion/prescription-availability notifications and duplicate prevention. Frontend tests validate the reused latest-request gate; they are not browser component tests.

Database behavior is **mocked**: real schema validation and in-memory transaction snapshots/write-conflict simulation, not MongoDB transaction verification. HTTP uses actual Express/JWT middleware and loopback servers with synthetic identities. Analytics tests verify pipeline construction, scoping and response forwarding, not MongoDB's execution engine. No live Gemini call or actual patient data was used.

Safe backend command (do not substitute npm test, which includes legacy destructive integration tests):

```powershell
node --test tests/scheduling.test.js tests/secretProtection.test.js tests/deploymentAuth.test.js tests/authSecurity.test.js tests/recommendationRoutes.test.js tests/recommendations.test.js tests/transactionSafety.test.js tests/consultationCompletion.test.js tests/doctorClinicalAuthorization.test.js tests/doctorAppointments.test.js tests/adminSafety.test.js tests/appointmentDomain.test.js tests/clinicalDomain.test.js tests/medicalFiles.test.js tests/medicalRecordsRoutes.test.js tests/clinicalHistory.test.js tests/clinicalHistoryRoutes.test.js tests/aiReliability.test.js tests/aiProtectionRoutes.test.js tests/portalCompletion.test.js tests/portalRoutes.test.js
```

Frontend: node --test tests/latestRequest.test.mjs; npm.cmd run lint; npm.cmd run build (includes TypeScript).

## Remaining gaps and deployment blockers

- Real replica-set transaction/index/concurrency/rollback verification remains pending. Admin mutations now require transactions just as scheduling/clinical operations already do; standalone MongoDB is insufficient. There is no unsafe fallback.
- Synthetic browser acceptance across portals and approved live Gemini staging evaluation remain pending. Automated mock success is not evidence of live correctness or clinical accuracy.
- Persistent private shared upload storage, restricted access and coordinated database/file backups remain required; Phase 4's recovery procedure applies.
- Optional email recovery remains unavailable unless explicitly enabled and configured. Do not deploy an improvised reset alternative. Scheduled reminders/health-tip delivery and external channels are not part of the functioning demo; preferences are persisted only for future supported senders.
- Rejected doctors have a documented administrator-contact correction workflow, not self-service resubmission. Admins can review and update the professional decision; adding an application-revision workflow is a separate scoped feature, not silently auto-approving a corrected doctor.
- Notifications poll, not push. List pagination is offset-based; new events can move rows between pages. Counts across multiple dashboard queries are live individual reads, not a single analytics snapshot. Historical counts can include legacy inconsistent documents that history screens intentionally withhold; investigate privately rather than changing records automatically.
- Existing history/doctor-review lists and analytics are not comprehensively optimized for large datasets. Multi-process AI limits, provider clinical/data-handling review, clinic-timezone constraints, production HTTPS/CORS/secrets and backup restoration still need deployment acceptance from prior reports.

## Manual acceptance / exact next task

Use only explicitly approved disposable/staging data. Do not run these write steps on existing records without permission.

1. Create synthetic patient/doctor accounts in approved staging. Confirm pending doctor sees reason/account notifications but cannot access clinical pages. Admin reviews real submitted fields, rejects with reason, then approves. Session refresh must reflect both transitions without mandatory email verification.
2. Double-submit an identical decision. Confirm one state transition/audit/notification. Inject audit/notification failures on the isolated replica set and confirm no partial decision/reason/status/session change. Test transaction unavailable and unknown-commit recovery.
3. Suspend a synthetic patient/doctor; old sessions must fail immediately on their next authenticated request. Reactivate; old JWTs must remain revoked, and fresh login must work. Confirm admin self-suspension is rejected.
4. Book/reschedule/cancel a synthetic appointment, then complete another with a prescription. Inspect patient/doctor notifications and links; retry the same operation and confirm event counts do not grow. Verify amendment/void events and history remain correct.
5. Guess another user's notification ID, read all, paginate beyond 30, and retry mark-read. Confirm ownership, stable timestamp, global unread count and badge refresh. Check loading/outage/retry states in each portal.
6. Change optional preferences; reload and sign in on a second browser. Confirm persistence and isolation from another account. Confirm essential account/clinical notifications remain enabled and the demo does not claim to send scheduled reminders/tips.
7. Compare admin filters/UTC inclusive end dates, audit events and analytics with the approved synthetic dataset. Test patient/doctor access to every admin endpoint is denied. Review browser console/network for failures and verify no fabricated business data.
8. Verify persistent-file restart/backup behavior, then run the prior Phase 5 synthetic-only Gemini acceptance with approval.

**Next development task:** provision and explicitly approve a disposable local MongoDB replica set, run the prepared Phase 3/4 scenarios, and add real-server verification of Phase 6 decision/audit/notification rollback and session revocation. Then perform the synthetic three-portal browser checklist and approved Gemini acceptance before UI redesign or release claims.
