# Disposable real MongoDB transaction verification

Status: **prepared, not run against MongoDB**. Do not interpret configuration or
unit-test success as transaction integration success. Obtain the user's explicit
confirmation of the disposable environment before running the mutation command.

## Safety boundary

This harness accepts only a separate JSON file, never `.env`, `MONGO_URI`, or
`MONGO_URI_TEST`. It does not import `server.js`, connect the default Mongoose
instance, call the old integration suite, or contain broad cleanup operations.
It rejects credentials, Atlas/SRV/remote endpoints, normal development ports,
arbitrary database names, extra URI options and missing confirmation. Local-only
fixtures intentionally have no credentials and contain synthetic data only.

Both servers must pass read-only checks BEFORE any test schema/index/fixture
write: exact database allowlist, expected one-member replica set/standalone,
MongoDB 8, a matching externally provisioned marker, and an otherwise pristine
database. These checks are independent of the connection string's `test` spelling.
Only after both checks pass are the ready markers atomically claimed for one use;
another runner cannot reuse the same fixture pair.
The replica set must permit test failpoints. An initial connection is made ONLY
after config and CLI confirmation; even preflight is not executed beforehand.

The server itself must be dedicated: failpoints are server controls, even though
they are restricted to the harness's unique application name. Do not repurpose a
shared local server or forward these ports to Atlas. A marker is evidence of
explicit provisioning, not a substitute for confirming the dedicated containers.

## Exact setup (Windows PowerShell; run from backend)

Prerequisites: Docker Desktop running with Linux containers; free local ports
27117/27118; existing installed Node dependencies. This machine had `mongosh` but
no `mongod` or Docker executable available during preparation. No software was
installed. The commands below are instructions, not commands already executed.

1. Generate a test-only config. This writes one ignored JSON file and does not
   connect to anything. It leaves `confirmedDisposable` false.
   If `disposable.local.json` already exists from preparation, skip the generator
   and run only the config check; the generator deliberately refuses overwriting.

```powershell
node .\tests\transactions\new-config.cjs
npm run test:transactions -- --config .\tests\transactions\disposable.local.json --check-config
```

2. Start NEW dedicated, disposable containers. No existing database directory or
   Docker volume is mounted. Container names intentionally fail if already in
   use; do not substitute an existing container. Data is held in temporary RAM
   filesystems, and host ports bind only to loopback. Do not start an application
   against these servers.

```powershell
docker run --detach --rm --name mediflow-tx-rs --publish 127.0.0.1:27117:27117 --tmpfs /data/db mongo:8.0 mongod --port 27117 --replSet mediflow_tx_rs --bind_ip_all --setParameter enableTestCommands=1
docker run --detach --rm --name mediflow-tx-standalone --publish 127.0.0.1:27118:27118 --tmpfs /data/db mongo:8.0 mongod --port 27118 --bind_ip_all
```

3. Initialize only the NEW replica-set container. If it is not ready, wait for
   startup and retry; never redirect the command to an existing MongoDB server.

```powershell
@'
rs.initiate({_id: "mediflow_tx_rs", members: [{_id: 0, host: "localhost:27117"}]})
'@ | docker exec -i mediflow-tx-rs mongosh --port 27117 --quiet

docker exec mediflow-tx-rs mongosh --port 27117 --quiet --eval 'db.adminCommand({hello:1}).isWritablePrimary'
```

Proceed only after the last command reports `true`. MongoDB's replica-set
[setup guide](https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set/)
describes initialization. `directConnection=true` keeps this single-node fixture
on its explicitly allowed loopback seed.

4. Provision the matching one-use marker databases on these two new containers.
   The provisioning script refuses an existing database, checks topology, and
   inserts only the marker. It performs no cleanup/deletion.

```powershell
$txConfig = Get-Content -LiteralPath .\tests\transactions\disposable.local.json -Raw | ConvertFrom-Json
$txFixtureId = $txConfig.fixtureId
Get-Content -LiteralPath .\tests\transactions\provision.mongosh.js -Raw | docker exec -i -e "MEDIFLOW_TX_FIXTURE_ID=$txFixtureId" -e MEDIFLOW_TX_KIND=rs mediflow-tx-rs mongosh --port 27117 --quiet
Get-Content -LiteralPath .\tests\transactions\provision.mongosh.js -Raw | docker exec -i -e "MEDIFLOW_TX_FIXTURE_ID=$txFixtureId" -e MEDIFLOW_TX_KIND=standalone mediflow-tx-standalone mongosh --port 27118 --quiet
```

5. Confirm to the assistant that BOTH containers are new/disposable, have no
   application mounts, the ports are dedicated, and the marker databases were
   provisioned. No credentials or connection strings need to be pasted into chat.
   ONLY AFTER that confirmation, authorize mutation by changing just the new
   config's `confirmedDisposable` to true (leave application `.env` untouched):

```powershell
$txConfig.confirmedDisposable = $true
$txConfig | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath .\tests\transactions\disposable.local.json -Encoding ascii
npm run test:transactions -- --config .\tests\transactions\disposable.local.json --confirm-disposable
```

The runner prints fixed scenario names and counts, never URIs, credentials,
clinical payloads or raw driver errors. A failure is a failure, not a skip or pass.
The command is deliberately separate from the old `test:integration` script.

## Real operations and expected coverage

`suite.cjs` binds cloned application schemas and the existing completion service
to separate test-only Mongoose instances. It does not mock model/driver methods.
It creates collections/indexes explicitly only after both preflights pass.

- Completion and exact committed consultation/prescription/audit/notification counts.
- Input rejection before persistence.
- Five real server write rejections using scoped collection validators, followed
  by inspection that earlier transaction writes and events were rolled back.
- Four simultaneous identical completions, conflicting completions and repeated
  cancellation/completion races.
- Actual unique-index definitions AND duplicate inserts for consultation,
  prescription appointment/consultation keys and patient/doctor appointment slots.
- Identical and conflicting retries; stale draft and cancellation document saves.
- Actual standalone transaction rejection; closed-client unavailability.
- One-shot and persistent commit acknowledgement uncertainty from server
  `failCommand` write-concern errors. A 5-second test-only client timeout bounds
  persistent retry, and identical replay must preserve the committed result.

Failpoints use `appName`, are restored in `finally`, and require a dedicated test
server with `enableTestCommands`. See MongoDB's
[failCommand reference](https://github.com/mongodb/mongo/wiki/The-failCommand-fail-point).
This exercises server-reported acknowledgement uncertainty, not an arbitrary
network partition, process crash, election, or multi-node replica durability.
The closed-client case does not prove recovery from a live server outage.

## After a run / failures

The suite intentionally keeps all synthetic records for inspection. It never
drops the database or deletes fixtures. A rerun against a used database is
rejected; explicitly prepare a fresh config/nonce and new marker databases.
The config generator refuses overwriting its existing file: archive that file
under another ignored `*.local.json` name before generating a new one.

If a process is forcibly interrupted, a failpoint/validator might remain active
on the disposable server. Do not reuse it. After inspecting results, manually
stop only these named test containers:

```powershell
docker stop mediflow-tx-rs mediflow-tx-standalone
```

Because they were created with `--rm` and no mounted data, their fixture data is
discarded. No cleanup command targets a host database path or any Atlas database.

## Safe checks before confirmation

Only these database-free tests/checks may run during preparation:

```powershell
node --test tests/transactionSafety.test.js tests/consultationCompletion.test.js tests/doctorClinicalAuthorization.test.js tests/doctorAppointments.test.js tests/adminSafety.test.js tests/appointmentDomain.test.js tests/clinicalDomain.test.js
node --check tests/transactions/run.cjs
node --check tests/transactions/suite.cjs
node --check tests/transactions/safety.cjs
node --check tests/transactions/provision.mongosh.js
node --check tests/transactions/new-config.cjs
```

Since Phase 7, `npm test` and `npm run test:safe` use an explicit database-free
allowlist. Never run the legacy `test:integration` suite against existing data.
Configuration checks and mocked tests do not establish real rollback or concurrency.

## Phase 3 scheduling extension (prepared, not executed)

The same confirmed disposable runner now also invokes `scheduling.cjs` after all
original isolation gates. It binds `createSchedulingService` to the test-only
connections and adds 12 real-operation scenarios: competing same-slot bookings,
different-start overlaps, cross-doctor patient contention, duplicate and conflicting
requests, concurrent reschedules, cancellation/reschedule and cancellation/completion,
notification-write rollback, availability races, stale draft protection, uncertain
booking commit acknowledgement, and standalone fail-closed behavior. No application
`.env` is loaded. Existing application databases remain prohibited.

The only configuration validation performed during Phase 3 was `--check-config`,
which attempted no connection. Explicit confirmation of the new dedicated servers,
allowlisted databases, synthetic writes, validators and failpoints is still required
before running `--confirm-disposable`. See `../../PHASE3_SCHEDULING.md` for API version
requirements and the Phase 3 review/acceptance checklist.
