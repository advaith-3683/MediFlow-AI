> Phase 3 update: new clinical completions and draft saves now require the loaded
> `appointmentVersion`; see [PHASE3_SCHEDULING.md](PHASE3_SCHEDULING.md). Booking,
> rescheduling, cancellation, availability, amendments and voiding now use the
> transactional scheduling service. Real MongoDB verification remains pending.

# Consultation completion

`POST /api/doctor/clinical/appointments/:id/complete` uses a MongoDB transaction.
The success response keeps `message`, `consultation`, `prescription`, `appointment`
(with patient/doctor population), and `safetyWarnings`. Receipt fields are private.

## Commit boundary

The transaction reads approval, appointment ownership/status, draft, prescription
history, and patient safety data with the same session. It validates candidate
consultation, prescription, audit documents and notification before its first
write, then conditionally claims a scheduled appointment and saves all documents
sequentially with that session. No deletes, compensating updates, provider calls,
or non-transactional completion writes occur. Draft fields omitted from the input
are preserved. Explicit empty fields still clear those fields, subject to required
completion fields. Completion rejects malformed/overlong input rather than
silently truncating it. Consultation optimistic concurrency prevents a stale
draft save from overwriting completed notes.
Appointment optimistic concurrency and the completion update's version increment
also prevent already-loaded patient/admin cancellation saves from overwriting a
committed completed status. Stale document saves return 409 `STALE_RECORD`.

MongoDB/driver transaction retries reload all attempt-local documents. Duplicate
keys trigger one fresh-session retry, then a 409 conflict. Existing issued or
voided prescriptions are never overwritten to complete a scheduled appointment.
Such inconsistent historical state requires explicit clinical review.

## Idempotency

The appointment is the idempotency scope. A private hash of the normalized request,
issued prescription ID (or null), and warning snapshot are committed with the
consultation. An identical authorized retry returns the stored completion without
creating more audit or notification documents. Changed input returns 409: use
amendments rather than rewriting completed notes. A replay returns current
prescription state, including subsequent void information, rather than reverting
history. Follow-up dates are checked for being in the future only for new
completion, so a previously successful request remains replayable later.

Legacy completed appointments have no receipt and return 409 without mutation;
no automatic repair/backfill is performed. Missing/inconsistent committed
prescription references also return 409. An uncertain commit acknowledgement
returns 503 with `COMPLETION_OUTCOME_UNKNOWN`; retry the identical payload. It
never triggers deletion or reversal of potentially committed records.

## Notifications and external delivery

The current notification channel is the durable `Notification` collection, read
by authenticated polling. Its document is committed atomically with the clinical
records and audits, so polling only exposes committed completion notifications.
There is no post-commit network delivery to lose, and no outbox worker is needed
for this channel. Notification write failure aborts completion; it is not swallowed.

Before adding email/SMS/push, insert a durable outbox event in this same
transaction. A separate worker must claim events, deliver after commit with
provider/idempotency keys, retry with backoff, and record delivery/failure state.
Do not call external providers from the retryable callback or replace this with
a best-effort post-response send. External delivery is not implemented here.

## Deployment prerequisite and verification

Use a transaction-capable replica set or sharded MongoDB deployment. A standalone
server is unsupported; completion fails closed (503 `TRANSACTIONS_REQUIRED` for
unsupported-operation errors), with no unsafe fallback. Existing collection
schemas/indexes, especially consultation appointment uniqueness and prescription
appointment/consultation uniqueness, must be provisioned and checked in staging.
This change does not connect to, inspect, migrate, or repair the real database.

The new tests use real Mongoose schema validation and fake session/model I/O.
They verify application control flow, session propagation, staged rollback,
retries and event deduplication; they do NOT verify real MongoDB isolation,
write conflicts, commit retry labels, index enforcement, or durability.

For real verification, first obtain explicit approval and provision a new,
dedicated disposable replica-set database with credentials restricted to that
database. Verify the cluster/database identity independently of URI substring
checks. Test simultaneous identical/conflicting completion, failures at each
write, cancellation/draft races, duplicate keys, and commit acknowledgement loss.
Inspect clinical records, audits and notifications after each scenario. Do not use
the existing dropDatabase-based HTTP integration suite or an application Atlas
database. No such real transaction tests were executed for this change.

The separate real-integration harness and exact disposable setup instructions are
now in [tests/transactions/README.md](tests/transactions/README.md). It requires
explicit confirmation and independent loopback-only configuration. It has been
prepared, not executed against MongoDB; real transaction guarantees remain
unverified until the confirmed disposable run passes.
