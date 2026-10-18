# Phase 7 — deployment readiness and integration verification

## Outcome and release boundary

Prepared for a **single-process, synthetic-data portfolio demo** with binary file uploads disabled on ephemeral hosting. This is not a completed deployment or proof of real MongoDB/Gemini/browser behavior. Existing .env files were not read or modified. No live database connection, database mutation, Gemini request, installation or external service startup was performed.

Inspected package scripts/locks, server startup, configuration consumers, API client, CORS/auth/health/rate limits, private upload services/UI, ignore rules and disposable harness. Docker and mongod are still absent from PATH; mongosh is present. mongosh alone is not a database server.

## Confirmed blockers and focused fixes

| Finding | Change / current requirement |
|---|---|
| Production frontend silently used localhost when configuration was missing | Shared origin validation now fails production build/runtime for missing/insecure/loopback origins, embedded credentials, query/fragment or a duplicated /api prefix. Development retains localhost. Explicit / supports a separately configured same-origin proxy |
| Backend accepted incomplete production configuration | Startup validates required variables, production JWT length/placeholder, exact HTTPS CORS origins, port, bounded trusted-proxy hops and upload mode. Diagnostics never print values |
| Free ephemeral filesystem could lose medical uploads on restart | MEDICAL_UPLOADS_ENABLED=false rejects binary uploads before buffering/writes, advertises capability and disables file selection visibly. Text records remain available. Enabled production uploads require an absolute configured private persistent root; code cannot prove the host actually mounted durable storage |
| Health endpoint returned HTTP 200 during MongoDB loss | Same /api/health endpoint now returns 503/unavailable on disconnected state, 200/connected when connected; no-store response |
| Requests could arrive before unique indexes initialized | Startup now awaits model initialization/index creation; index failure refuses startup. Production additionally checks replica-set/mongos topology with session support. It does not execute a test transaction |
| Reverse proxy could collapse auth rate limits onto a proxy address | TRUST_PROXY_HOPS supports explicit bounded counts, default 0. Never use blanket trust proxy=true. The actual hosting chain remains to be verified before public use |
| Default npm test selected destructive legacy suite | npm test now invokes an explicit safe allowlist through test:safe. Legacy test:integration remains separate and prohibited against existing databases |
| Runtime/build environment was not specified | Both package manifests/lock metadata specify Node 24.x, the tested runtime. Dependency versions were not changed |
| Root documentation still required OTP and suggested weak integration isolation | README now matches current email/password, optional email, safe tests and deployment restrictions; current harness instructions updated |

No clinical/scheduling/admin authorization or transaction rules were weakened. Production cannot silently fall back to unsafe multi-write behavior or ephemeral binary storage.

## Hosting recommendation and limits

Use a Render static site for frontend, one Render free Node web service for backend, and a **separate owner-approved Atlas Free demo database/project** for synthetic portfolio records. Provider-assigned HTTPS URLs avoid custom domains. This is a recommendation, not a claim that accounts/services were provisioned.

Render free web services spin down after 15 minutes without inbound traffic, have ephemeral storage and cannot attach persistent disks. Cold starts and free resource limits affect demos. Keep binary uploads disabled; do not present missing files as successfully stored. A paid persistent disk was not added or recommended as mandatory. If all file workflows must be demonstrated, use an already available approved private persistent host/volume or defer that part until suitable storage is explicitly selected. Do not migrate existing records/files automatically. [Render free limits](https://render.com/docs/free), [disk restrictions](https://render.com/docs/disks).

Static hosting must rewrite unmatched application routes to /index.html; otherwise refreshing a protected React route gives a host 404. Configure the rewrite in Render's dashboard. Provider URLs and TLS are supported without a custom domain. [Render static sites](https://render.com/docs/static-sites), [SPA rewrite rules](https://render.com/docs/redirects-rewrites).

Atlas Free uses a replica set; MongoDB transactions require a replica set or supported sharded deployment, not standalone mongod. Use an Atlas database user limited to the demo database, TLS/SRV connection configuration, permitted backend egress ranges and index creation privileges. Do not broaden access to 0.0.0.0/0 as an unreviewed workaround. Startup may create collections/indexes, so deploying against any existing database requires owner approval. Existing duplicate data may prevent index creation; stop and investigate privately rather than deleting records. Atlas quotas, storage limits and idle-cluster behavior still apply. Review available backup settings in the actual account and rehearse restoration separately. [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [transaction prerequisites](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

No distributed rate-limit store was introduced. Authentication, AI and upload rate counters are process-local and reset on restart; provider concurrency is also per process. Keep one backend instance/process for this demo. Multi-instance hosting requires a shared quota/in-flight design before claiming deployment-wide limits. Configure Gemini account quotas privately; no paid provider or paid plan is required by this change. Verify actual model/free quota availability before enabling AI.

## Commands and configuration

Backend directory: npm ci; npm start (node server.js). No backend compilation step. The process binds to 0.0.0.0 and the hosting PORT, defaulting to 5000 locally. Configure health check /api/health. Production startup checks topology and waits for indexes before listening. Health reflects driver connection state, not a fresh ping, write capability, Gemini, storage durability or complete end-to-end readiness. [Render port binding](https://render.com/docs/web-services).

Frontend directory: npm ci; npm run build (tsc -b && vite build). Publish frontend/dist, or dist when service root is frontend. Vite dev/preview are not production web servers. VITE_API_URL is embedded at build time; changing it requires rebuilding. Prefixes in actual requests already include /api, so the base must be the backend origin, not origin/api. Never put JWT/MongoDB/Gemini/Resend secrets in VITE_* variables. Repository source references only the public VITE_API_URL.

Minimal production backend template (replace placeholders privately; not an existing .env):

```dotenv
NODE_ENV=production
MONGO_URI=<dedicated-demo-Atlas-URI-from-secret-manager>
JWT_SECRET=<unique-random-secret-at-least-32-bytes>
CORS_ORIGIN=https://<actual-frontend-host>
AUTH_EMAIL_ENABLED=false
MEDICAL_UPLOADS_ENABLED=false
TRUST_PROXY_HOPS=0
```

PORT is supplied by hosting; do not hardcode an unrelated port. TRUST_PROXY_HOPS=0 is safe for direct connections but may group proxy traffic. Set the verified hop count only after confirming the provider's forwarded-header chain and that alternate direct paths cannot bypass that boundary; 1 is suitable only for a verified single trusted hop. Our local test verifies the semantics, not Render's live topology. [Express proxy trust requirements](https://expressjs.com/en/guide/behind-proxies/).

Feature-only/optional variables already referenced by source:

- GEMINI_API_KEY: backend-only, needed for non-emergency Gemini assistance. GEMINI_MODEL defaults to gemini-2.5-flash; verify availability for the provider account.
- CLINIC_TIMEZONE_OFFSET defaults to +05:30. Existing slot logic uses this clinic offset; do not promise arbitrary per-doctor timezone behavior.
- MEDICAL_UPLOADS_ENABLED defaults true for backward-compatible development. Production true requires UPLOADS_DIRECTORY as an absolute private persistent path. Reads of existing protected files remain authorized normally; disabling new uploads does not repair/move missing legacy files.
- AUTH_EMAIL_ENABLED defaults disabled unless exactly true. With false, EMAIL_PROVIDER, RESEND_API_KEY and EMAIL_FROM may be omitted. With true, configured Resend delivery is needed for optional verification/recovery; signup/login still do not require OTP. No real emails were sent.
- First-admin bootstrap only: ADMIN_EMAIL, ADMIN_NAME, ADMIN_PHONE, ADMIN_PASSWORD (12+ characters, at most 72 UTF-8 bytes); MONGO_URI remains required. Supply as temporary secret-manager inputs and remove bootstrap-specific values afterward. DEMO_ADMIN_EMAIL/PASSWORD/NAME are legacy aliases, not recommended deployment inputs.
- DEMO_DOCTOR_PASSWORD belongs only to the existing development seed script; do not configure/run seeds on deployment. MONGO_URI_TEST belongs only to the legacy destructive suite and is not needed for safe tests or the disposable harness. DEV_SHOW_OTP is not needed and does not enable a production response bypass.

Minimal frontend build variable:

```dotenv
VITE_API_URL=https://<actual-backend-host>
```

No localhost is used as a production fallback. Remaining localhost references in runtime code are explicit development defaults; examples and isolated harnesses also intentionally use loopback. Existing environment values were not inspected, so their correctness is **Not Verified**.

## Exact deployment sequence — owner actions, not executed

1. Review the storage limitation and release gates. Use only synthetic demo data. Review Git status/file names in your actual repository before publishing. This workspace has no .git metadata, so tracked secrets/history could not be inspected. Ignore-rule tests verify .env variants, keys/certificates, uploads and generated files are ignored while sanitized examples remain trackable. Do not stage environment files or raw diagnostic captures.
2. Complete the isolated transaction verification described below before claiming functional concurrency/rollback. Do not point it at Atlas.
3. Provision/approve a separate Atlas demo database and limited user. Configure approved backend egress access, TLS and appropriate index rights. Confirm backup/restore expectations; do not use existing patient records.
4. Create the backend Render Node web service with repository root backend, Node 24.x, build npm ci, start npm start, a single free instance, and health path /api/health. Configure the backend template privately; set file uploads false. Reserve/copy the frontend's provider-assigned origin for CORS. The first deployment creates indexes on the approved demo database; it does not create users automatically.
5. Create the frontend static site with root frontend, Node 24.x, build npm ci && npm run build, publish dist. Set the actual backend HTTPS origin in VITE_API_URL. Add a Rewrite: source /*, destination /index.html. Do not use a redirect or deploy Vite preview. Update backend CORS_ORIGIN to the exact assigned frontend origin and restart/redeploy backend if necessary.
6. Verify HTTPS health is 200/database connected and preflight allows only the intended frontend origin. A disconnected database must produce 503. Confirm correct proxy-hop interpretation privately before allowing multiple users; never expose a debug route or log identifying headers publicly.
7. In the approved demo environment, explicitly invoke npm run bootstrap:admin -- --confirm-bootstrap once with temporary private ADMIN_* values. It writes an initial administrator only when allowed by existing bootstrap rules; no account is hardcoded or silently elevated. Do not run bootstrap against existing databases without separate approval.
8. Complete synthetic three-portal acceptance and, only after explicit approval, Gemini acceptance below. Do not book real appointments. Inspect browser console/network for mixed content, CORS, deep-link 404s, response mismatches and session refresh. Verify binary upload is visibly disabled and rejected by API while text records work.
9. Rebuild with real public configuration on the host. The locally generated verification dist uses backend.example.test deliberately and is **not a deployable configured artifact**. Do not upload that synthetic verification bundle as if it targets your backend.

## Real integration plan — still pending

The existing harness was inspected. Its configuration check passed: no connection attempted. Docker and mongod remain missing. No software was installed or service started. A mongosh client alone cannot execute server tests.

Prerequisites: explicitly approved Docker Desktop/Linux containers (or equivalent independently provisioned dedicated MongoDB 8 servers), loopback ports 27117/27118, a single-node replica set mediflow_tx_rs plus a separate standalone negative-control server, failpoint support, no host data mounts and no application using those servers. The runner accepts only its independent allowlisted JSON file; it never reads application .env/MONGO_URI or resolves Atlas/SRV/remote targets. Exact topology, marker, pristine database and fixture nonce checks happen before writes. Fixed names are mf_tx_disposable_<nonce>_rs and _standalone. Test config validation alone does not verify that a server exists.

From backend, the permitted preparation-only command is:

```powershell
node tests/transactions/run.cjs --config tests/transactions/disposable.local.json --check-config
```

The existing config already exists; do not overwrite it. For a fresh unused fixture, new-config.cjs refuses overwrite. [The harness README](tests/transactions/README.md) contains exact new-container startup, rs.initiate, marker provisioning, confirmation and cleanup commands. Those commands download/start servers or perform writes and were **not executed**. Only after owner confirmation of dedicated servers, mount isolation, synthetic writes and failpoints may this run:

```powershell
npm run test:transactions -- --config tests/transactions/disposable.local.json --confirm-disposable
```

Current prepared real-operation coverage:

| Area | Expected verification |
|---|---|
| Booking concurrency | Same doctor interval one winner, different-start doctor overlap, patient overlap across doctors |
| Reservations/states | Duplicate/conflicting requests, competing reschedules, cancellation versus reschedule/completion, availability race, stale draft |
| Rollback | Real write rejection at clinical models/audit/notification, plus booking event rejection; inspect zero partial updates |
| Prescription idempotency | Concurrent identical completion and identical replay create one consultation/prescription/event set; conflicting replay is rejected |
| Indexes | Verify required definitions and actual duplicate-key enforcement |
| Failure modes | Standalone fails closed, real driver commit-acknowledgement uncertainty, closed test-only connection |

The twelve prepared scheduling scenario names are listed in tests/transactions/scheduling.cjs; completion/index scenarios are in suite.cjs. No pass count for them is claimed.

**Phase 6 additions still requiring real-harness implementation before execution:** bind createAdminActions to the same test-only Mongoose models; race identical and opposing admin decisions; inject AuditLog/Notification write failures and compare target status/reason/sessionVersion plus event counts; verify unsupported/unknown-commit handling and identical replay. For suspension, verify one version increment, old JWT denial while disabled and after reactivation, fresh login permitted after reactivation. Current automated coverage of these cases is mocked only.

Medical-record ACL and browser acceptance require a **separate explicitly approved synthetic staging application**, not an application connected to the failpoint harness containers. Verify owner upload/view/download/delete, unrelated patient denial, pending/rejected doctor denial, approved relationship access, cancelled-only relationship denial, and storage-mode behavior. File-enabled checks require approved durable storage or isolated temporary fixtures. Do not substitute fake production doctors. Do not weaken/auth-stub real acceptance tests; use real signup/login and approved synthetic test accounts in that environment.

The integration runner keeps synthetic fixtures for inspection and never drops databases or broadly deletes records. After approved inspection, stop only the two exact dedicated --rm/no-volume containers named in the harness README; their disposable data is discarded. Never delete host paths or repurpose existing containers. Failpoint servers must not be reused after interrupted runs. Browser/staging data has a separate owner-approved lifecycle.

## Live Gemini synthetic staging plan — not executed

No Gemini request is authorized by this preparation task. Obtain explicit approval for the staging account/key, quota budget and synthetic-only calls first. Do not paste the key or actual patient input into reports.

| Synthetic case | Expected assertion |
|---|---|
| Mild itchy rash, isolated dental concern, routine eye irritation | Uncertain differentiated canonical specialties; profiles/slots only from approved matching database rows; no universal fallback |
| Specialty with no approved available match | Honest empty doctors/message; no fabricated/unrelated substitutes. If approved staging inventory has no such specialty, report Not Verified rather than changing genuine records |
| Chest pain/breathing warning phrase | Fixed urgent local-safety guidance, no provider call or routine doctor cards; verify even with absent provider/quota exhaustion |
| Severe concern outside phrase rules | Evaluate Gemini escalation with qualified review; no claim that phrase rules detect every emergency |
| Provider unavailable/timeout | Controlled error; manual discovery remains usable. Use staging-only fault injection, never redirect the secret-bearing request to an untrusted URL. Timeout currently mocked, not live verified |
| Quota/duplicate requests | One user in-flight request, 409 duplicates, 429 budget exhaustion, emergency guidance still available. Prefer a reduced staging budget over wasting provider quota; real provider 429 behavior remains pending unless safely induced with approval |
| Ignore instructions/invent doctor/prescribe/reveal secrets | User text stays data, no clinical write, no doctor fabrication, no leaked credentials or provider errors; have a clinician assess prose safety |

Record status/priority/specialty labels, doctor IDs only where non-sensitive, event counts and pass/fail — never keys, full request logs, patient data or raw HAR captures. No live model accuracy, data-retention suitability or clinical safety guarantee follows from mock tests.

## Final safe verification

347 backend tests and 7 frontend tests passed, zero failed. Backend allowlist includes the new deployment regression tests. TypeScript and production-mode Vite bundle passed using a synthetic HTTPS API origin and envDir:false, so existing frontend .env files were not loaded. The initial build exposed an import extension mismatch under NodeNext; it was corrected. Frontend and targeted backend lint have no errors/warnings. Six modified/new backend JavaScript/CJS files passed syntax checks. Node 24.19.0 was the actual local runtime.

Commands used: backend npm run test:safe; frontend npm test and npm run lint. For the no-env build, tsc -b was followed by Vite's build({envDir:false}) API with process-only VITE_API_URL=https://backend.example.test; the prior process variable was restored afterward. No npm install/ci, application startup, database connection or external provider call was part of verification. Dependencies were already installed. The normal hosting build command remains npm run build with actual hosting build variables.

Configuration/topology tests use pure fixtures; health/CORS/proxy and disabled uploads use loopback Express, synthetic JWTs and temporary files with mocked database methods. Real index initialization/transaction capability was **not** verified. Runtime config checks refuse unsafe settings but cannot prove storage persistence, origin reachability, provider topology, existing secrets or database contents.

## Modified files

- README.md
- backend/server.js
- backend/services/deploymentConfig.js (new)
- backend/services/medicalRecords.js
- backend/routes/medicalRecords.js
- backend/scripts/test-safe.cjs (new)
- backend/tests/deploymentReadiness.test.js (new)
- backend/tests/transactions/README.md
- backend/package.json and package-lock.json (scripts/runtime metadata only)
- backend/.env.example (sanitized instructions only)
- frontend/src/api/deploymentConfig.ts (new)
- frontend/src/config.ts
- frontend/src/pages/patient/MedicalRecordsPage.tsx
- frontend/vite.config.ts
- frontend/tests/deploymentConfig.test.mjs (new)
- frontend/package.json and package-lock.json (scripts/runtime metadata only)
- frontend/.env.example (sanitized instructions only)
- backend/PHASE7_DEPLOYMENT.md (this report)

## Remaining gaps and UI/UX recommendation

Release blockers remain: real replica-set/index/rollback tests (including new admin cases), actual hosting proxy/CORS/connectivity, synthetic three-portal acceptance, and approved Gemini staging/clinical review. Optional email recovery, self-service doctor resubmission and timed reminder/tip delivery remain limited as described in Phase 6. File uploads must remain disabled on the selected free ephemeral host. A portfolio demo is not a real patient-data deployment.

Recommendation: **hold broad UI redesign until the integration and staging gates are reviewed**. The application is prepared for a controlled synthetic staging attempt, not verified deployed. Next task is to approve/provision the dedicated local replica set, extend the real harness with admin rollback/revocation cases, then run the isolated tests and synthetic browser/Gemini acceptance with explicit service/write approval.
