# Phase 4: medical records and clinical history

## Scope and findings

Existing authenticated patient records, approved-doctor clinical context, transactional completion, prescription voiding, consultation amendments, and patient history were retained. Phase 3 scheduling guards were preserved. No live database, real medical record, or existing environment file was accessed for verification.

Defects repaired:

- Frontend record types differed from the database enum. The API now supplies canonical types; legacy `Imaging` input maps to `Scan`, and `Discharge Summary` is supported.
- Uploads trusted request MIME and wrote files before validating metadata. Metadata, extension, MIME, actual byte size, and structural contents are now checked before storage. Files are limited to 10 MiB and authenticated uploads are rate limited.
- Early failures could leave untracked files, and deletion discarded metadata before filesystem cleanup. Durable pending/deleting receipts now support recovery without deleting files after uncertain database acknowledgements.
- File access now validates strict storage keys, rejects symlinks/traversal, checks contents and stored digest, and returns private/no-store responses. Doctor access requires approval and a scheduled or completed clinical relationship; cancelled-only relationships do not qualify. Doctor context/file access records controlled audit metadata.
- Prescription/history reads now require consistently owned completed consultation/appointment records. Draft, cancelled, dangling, and inconsistent records are withheld without changing them. Doctor-only notes and vitals stay out of shared history. Completed history does not depend on the doctor's current approval status; current authorization is still required for doctor access.
- Prescriptions support append-only narrative amendments. Original medicines remain unchanged. Amendments and voiding validate linked completed records and use existing transaction guards. Audit and in-app notification writes participate in the same transaction.
- Completed doctor workspace shows issued prescriptions, amendment history, and controls for amendments/void reasons. Completion refreshes authoritative context; refresh failure is reported separately from successful completion. Patients can explicitly download records and view prescription amendments.

## Consistency and limitations

MongoDB transactions cover clinical amendments, voiding, audit events, and in-app notifications, using the existing retry/session mechanism. External email is not sent by these operations. Existing unique prescription/consultation indexes remain necessary. Real MongoDB transaction behavior has **not** been verified in this phase.

Amendment requests accept an optional 16–128 character URL-safe `requestId`. Identical retries return the existing amendment without another audit/notification; conflicting text for the same key returns 409. Without a key, identical normalized text on the same record is treated as a retry. A distinct explicit key permits a separate intentional entry. Voiding retries with the same reason retain the existing result. These endpoints do not edit original medication entries or implement replacement/reissue prescriptions; a narrative clarification must not be treated as a new medication order.

MongoDB and the local filesystem do **not** share a transaction. Pending metadata is written before the file; only ready records are visible. Deletion first hides metadata as deleting, removes the exact file, then deletes the exact receipt. Failures retain recoverable receipts. Lost acknowledgements never trigger deletion of possibly committed uploads. An uncertain upload returns 503 and must be reconciled before retrying to avoid duplicate submissions. Legacy records with absent storageState remain readable, subject to validation. Legacy orphan files are not automatically swept.

File validation is bounded structural checking, not full image decoding, PDF sanitization, antivirus, or a malware-free guarantee. Obvious active/encrypted PDF features are rejected, but this is not exhaustive. Some legitimate unsupported/active legacy files may be rejected and need operator review. Blob preview behavior still needs browser acceptance testing. Application-only control of the storage directory is required. Memory uploads consume up to 10 MiB per concurrent request; rate limiting is per process, so deployment request/concurrency limits remain necessary.

## Deployment storage

`UPLOADS_DIRECTORY` is optional; default is backend/uploads. For deployment, configure an absolute path on a persistent private volume. Do not serve it with static middleware or a public web server. All backend replicas must share the same persistent storage, or run a single instance until an approved shared-storage adapter is provided. Restrict filesystem permissions to the backend account, encrypt the volume/backups, and back up MongoDB and files together. Ephemeral server storage is insufficient. Existing files must be copied by the operator when changing the root; changing the variable does not migrate them. No storage service or paid dependency was introduced.

## Recovery procedure (operator action; not executed)

Stop all backend instances and uploads/deletes before maintenance. Back up the database and storage together. Confirm the intended deployment database privately; the maintenance command uses normal application configuration and is **not** an isolated test runner.

From backend:

```powershell
# Read-only counts of pending/deleting receipts older than one hour:
npm.cmd run records:reconcile -- --confirm-maintenance
# After reviewing counts, explicitly authorize exact-receipt recovery:
npm.cmd run records:reconcile -- --confirm-maintenance --apply
```

Without confirmation the CLI exits before loading dotenv or connecting. Dry run does not read/delete file contents or mutate records. Apply promotes valid pending files, removes invalid/missing pending receipts and their exact files, and finishes deleting receipts. It never deletes ready clinical records or sweeps unknown files. Failed entries produce a nonzero exit status and count only; investigate privately. Resume application instances after recovery. A recent interrupted upload may need to age one hour before recovery. Never execute these commands against existing records without the owner's explicit approval.

## Modified files

- backend/.env.example (optional storage path documentation only)
- backend/package.json
- backend/models/MedicalRecord.js
- backend/models/Prescription.js
- backend/routes/medicalRecords.js
- backend/routes/doctorClinical.js
- backend/routes/patientClinical.js
- backend/services/medicalFiles.js (new)
- backend/services/medicalRecords.js (new)
- backend/services/clinicalHistory.js (new)
- backend/services/clinicalDomain.js
- backend/services/scheduling.js
- backend/reconcileMedicalRecords.js (new)
- backend/tests/helpers/medicalFixture.cjs (new)
- backend/tests/medicalFiles.test.js (new)
- backend/tests/medicalRecordsRoutes.test.js (new)
- backend/tests/clinicalHistory.test.js (new)
- backend/tests/clinicalHistoryRoutes.test.js (new)
- backend/tests/secretProtection.test.js
- frontend/src/pages/patient/MedicalRecordsPage.tsx
- frontend/src/pages/patient/PrescriptionsPage.tsx
- frontend/src/pages/doctor/ConsultationWorkspacePage.tsx
- backend/PHASE4_MEDICAL_RECORDS.md (this report)

## Verification

Final results: 275 selected backend tests passed, 0 failed; 3 frontend tests passed, 0 failed. Syntax checks passed for all 17 changed/new backend JavaScript/helper files. Frontend TypeScript and production build passed. Frontend lint passed; targeted backend lint returned no errors and one no-thenable warning for the deliberate mock Mongoose query adapter in tests/helpers/medicalFixture.cjs. No browser acceptance or real MongoDB verification was performed.

Safe unit/HTTP tests use mocked database operations, real Mongoose schema validation, synthetic JWTs, loopback HTTP, and isolated OS temporary files. Transaction tests use the existing in-memory snapshot/write-set harness, not a real MongoDB server. Tests cover content spoofing/truncation/size, types, ownership, approval, cancelled relationships, traversal/symlinks/tampering, private downloads, upload/database/filesystem failures and uncertain acknowledgements, recovery, history filtering, append-only amendments, concurrent duplicate requests, conflicting keys, voids, audit/notification rollback, and maintenance refusal.

Run only the explicitly selected safe test files; `npm test` still includes the legacy destructive HTTP integration suite and was not run. Disposable MongoDB integration remains deferred until a local replica set is available and explicitly approved.

```powershell
# From backend (no database connection):
node --test tests/scheduling.test.js tests/secretProtection.test.js tests/deploymentAuth.test.js tests/authSecurity.test.js tests/recommendationRoutes.test.js tests/recommendations.test.js tests/transactionSafety.test.js tests/consultationCompletion.test.js tests/doctorClinicalAuthorization.test.js tests/doctorAppointments.test.js tests/adminSafety.test.js tests/appointmentDomain.test.js tests/clinicalDomain.test.js tests/medicalFiles.test.js tests/medicalRecordsRoutes.test.js tests/clinicalHistory.test.js tests/clinicalHistoryRoutes.test.js
# From frontend:
node --test tests/latestRequest.test.mjs
npm.cmd run lint
npm.cmd run build
```

## Manual acceptance (use approved disposable/synthetic data)

1. Patient: upload a valid PDF/PNG/JPEG and each supported type; list, view, download, then delete. Confirm invalid, oversized, and spoofed files fail without appearing.
2. Another patient: confirm record URLs and deletion are denied. Confirm unauthenticated requests fail.
3. Pending/rejected/unrelated doctor: confirm file/history access fails. Approved doctor with scheduled or completed relationship can access permitted records. Cancelled-only relationship cannot.
4. Complete a synthetic consultation. Reload both portals: patient sees completed summary/prescription; doctor sees original notes and issued medicines. Doctor-only notes remain absent from patient responses.
5. Append consultation and prescription clarifications; retry the same request. Confirm one amendment/audit/notification and unchanged originals. Verify conflicting key returns 409.
6. Void with a reason, retry, and confirm patient sees void status with retained medicines/amendments. New amendment to a voided prescription must fail.
7. In an approved disposable environment, inject storage/database failures, stop application instances, then review dry-run recovery before applying. Check restart persistence and backup restoration.

Next task: provision and approve a disposable local MongoDB replica set, then run the prepared transaction/concurrency tests and extend real-server coverage to Phase 4 amendment/void rollback. Follow with the browser acceptance steps above before deployment. Do not advance to unrelated UI polishing.
