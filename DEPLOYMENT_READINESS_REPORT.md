# MediFlow AI portfolio-demo deployment readiness

Prepared 2026-10-18. **Not deployed. Public release remains conditional on the gates below.** Existing `.env` files were not read or changed. No Atlas connection, database mutation, provider request or bootstrap was executed.

## Verified architecture and repository evidence

| Component | Target | Repository evidence and behavior |
| --- | --- | --- |
| Frontend | Vercel Hobby, provider HTTPS subdomain | React/TypeScript/Vite, BrowserRouter, `frontend/package.json`, production API-origin validator and new `frontend/vercel.json` |
| Backend | One Render Free Node web service, provider HTTPS subdomain | Express `backend/server.js`; `npm start` runs `node server.js`; no compilation step |
| Database | Existing Atlas cluster, isolated owner-approved synthetic demo database | Mongoose; production startup requires replica-set/mongos session topology and awaits model/index initialization |
| AI | Existing backend Gemini adapter | Backend-only key, input/schema checks, timeout, local emergency guidance and request protection; live behavior not verified here |
| Files | No binary storage on Render Free | Existing upload capability endpoint and API/UI disable path; explicitly set `MEDICAL_UPLOADS_ENABLED=false` |
| Email | Disabled | Set `AUTH_EMAIL_ENABLED=false`; email/password signup and login work without Resend. Optional verification/recovery remain unavailable |

Inspected Phase 7 documentation, package manifests/scripts, server, deployment validator, API configuration, authentication/authorization middleware, scheduling transaction wrapper, admin bootstrap, development doctor seed, AI routes/protection, error handling, ignore rules, existing deployment tests and demo runbook. Historical Phase 7 results are superseded by this run's safe results below; its real-integration plans remain relevant.

## Exact hosting settings

### Vercel

| Setting | Value |
| --- | --- |
| Plan | Hobby, subject to its personal/non-commercial terms and usage limits |
| Root Directory | `frontend` |
| Framework Preset | Vite |
| Node.js | 24.x, matching package engines |
| Install Command | `npm ci` |
| Build Command | `npm run build` (`tsc -b && vite build`) |
| Output Directory | `dist` |
| Production environment | `VITE_API_URL=https://<backend-service>.onrender.com` |
| SPA routes | Committed `frontend/vercel.json`: `/(.*)` rewrites to `/index.html` |

No frontend production start command is needed: Vercel serves the compiled static files. Do not run `vite`, `npm run dev` or `npm run preview` as the deployed server. The API origin is embedded at build time and changing it requires rebuilding. Use the backend origin without `/api`, query, credentials or fragment. Existing requests already contain `/api`.

The rewrite follows [Vercel's Vite SPA instructions](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas). It prepares direct refreshes of patient, doctor and admin routes; actual hosted routing still requires acceptance testing. Backend calls go directly to Render, not through the SPA rewrite. Review [Hobby plan eligibility](https://vercel.com/docs/plans/hobby) before publishing; this plan is not a general commercial deployment entitlement.

### Render

| Setting | Value |
| --- | --- |
| Service Type | Web Service |
| Runtime | Node |
| Instance Type | Free |
| Root Directory | `backend` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Processes/instances | One Node process, one instance; no PM2 cluster or worker replicas |
| Node.js | 24.x via existing bounded package engines; ensure no account/service override selects another major |
| Disk | None; binary uploads disabled |
| Deploy control | Keep automatic deployment disabled until configuration/data review; no migration or bootstrap in build/start commands |

Render supplies `PORT`; the application binds `0.0.0.0` and uses that port. Do not fix it to a local development port. [Render Express deployment](https://render.com/docs/deploy-node-express-app), [Node version selection](https://render.com/docs/node-version).

## Environment checklist: placeholders only

Configure hosting dashboards privately. Do not commit these values or paste them into public reports.

Required Render application configuration for this target:

```dotenv
NODE_ENV=production
MONGO_URI=mongodb+srv://<encoded-demo-db-user>:<encoded-password>@<atlas-host>/<isolated-demo-database>?retryWrites=true&w=majority
JWT_SECRET=<unique-cryptographically-random-secret-at-least-32-bytes>
CORS_ORIGIN=https://<frontend-project>.vercel.app
AUTH_EMAIL_ENABLED=false
MEDICAL_UPLOADS_ENABLED=false
TRUST_PROXY_HOPS=<verified-trusted-proxy-hop-count>
```

- `MONGO_URI` and `JWT_SECRET` are required at startup; production also requires explicit HTTPS `CORS_ORIGIN` and a suitable upload mode. Placeholder JWTs and secrets shorter than 32 bytes are rejected.
- `NODE_ENV=production` enables production checks. The two false feature flags are explicit requirements of this no-email/ephemeral-storage deployment, even though the application has development-compatible defaults.
- `TRUST_PROXY_HOPS` is an integer 0–5, default 0. Determine the real hosting forwarding chain before public release. Use 1 only after establishing one trusted hop; do not blindly enable all proxy trust. Zero is conservative but may group users behind a proxy into one rate-limit bucket. This configuration cannot be verified from source alone. Do not expose a public IP/header debug endpoint.
- `PORT` is provided by Render; omit a manual value.

Feature/optional Render settings:

| Name | Requirement/default |
| --- | --- |
| `GEMINI_API_KEY` | Required for provider-backed AI; backend secret only. Without it, manual specialty discovery and local emergency handling remain available, provider assistance does not |
| `GEMINI_MODEL` | Optional, defaults to `gemini-2.5-flash`; verify model availability and free quota in the existing account |
| `CLINIC_TIMEZONE_OFFSET` | Optional, defaults to `+05:30`; preserve current scheduling interpretation |
| `UPLOADS_DIRECTORY` | Omit with uploads disabled. Enabled production uploads require an absolute private persistent directory, unavailable on Render Free |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | Omit with `AUTH_EMAIL_ENABLED=false`; configure only if optional email is later approved |

First-administrator bootstrap only: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_PHONE`, plus the approved demo `MONGO_URI`. Phone must be 10–15 digits; bootstrap password must be at least 12 characters and no more than 72 UTF-8 bytes. `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_ADMIN_NAME` are legacy aliases; do not use them as public demo credentials. `DEMO_DOCTOR_PASSWORD` belongs to the development-only seed and is not a deployment input. Do not configure `DEV_SHOW_OTP` or the destructive legacy suite's `MONGO_URI_TEST`.

Vercel application configuration is **only** `VITE_API_URL`. Source inspection found no backend secrets referenced through frontend environment variables. Never prefix MongoDB, JWT, Gemini, Resend or bootstrap secrets with `VITE_`. Use the exact production Vercel origin for CORS. Preview URLs are distinct origins and are not automatically authorized; use a separately approved staging environment or explicit exact allowlist, never `*.vercel.app` wildcard trust.

## Database readiness, storage and restart safety

Production startup connects to MongoDB, issues `hello` to check transaction-capable topology/session support, and awaits initialization of User, Appointment, Consultation, Prescription, MedicalRecord, AuditLog and Notification indexes before accepting requests. Failures stop startup with a generic diagnostic. This is source/mock verification, not proof that the actual Atlas user can initialize indexes or commit a transaction.

Use a database user scoped to a separately named synthetic demo database on the existing cluster. Include that database explicitly in the URI. Grant only needed application and index-creation privileges. Configure TLS/SRV with Atlas's current driver connection instructions and properly encode credentials. Do not reuse an unrestricted account or a database containing genuine patient information. Startup may create collections/indexes, so even first startup against an existing database is a write requiring approval.

Atlas allows connections only from its configured [IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/). After owner authorization, obtain the service's actual outbound CIDRs from Render's **Connect → Outbound** panel and allow those ranges; do not use an unreviewed `0.0.0.0/0` workaround. Render's outbound ranges are region-shared, so database credentials and least privilege remain essential. [Render outbound IP documentation](https://render.com/docs/outbound-ip-addresses). Transactions require a [replica set or supported sharded topology](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/); standalone MongoDB is unsupported. Atlas plan, existing duplicates/index health, quotas and backups have not been inspected.

`/api/health` returns no-store JSON with HTTP 200/database connected when driver `readyState` is 1, and 503/database unavailable otherwise. It does not run a fresh ping, test writes, Gemini, storage durability or end-to-end functionality. Before initial database/index readiness the HTTP server does not listen.

[Render Free](https://render.com/docs/free) sleeps after idle traffic, can restart, and loses local filesystem changes; it cannot attach a persistent disk. Keep `MEDICAL_UPLOADS_ENABLED=false`. Existing tests verify binary requests are rejected before storage work and the capability disables file selection. Text records remain database-backed. Runtime hosting settings are **Not Verified** until configured; legacy file metadata does not mean its binaries exist on Render. Do not migrate/delete files automatically.

Scheduling and clinical writes use database transactions, majority write concern and database-backed serialization/idempotency rather than process-local reservation locks. Committed database records survive application restarts; interrupted transactions must not be treated as confirmed success. A lost acknowledgement can leave the client uncertain: reload the appointment/history or retry the identical supported request ID; never assume a timeout means nothing committed. These guarantees are implemented but real rollback, restart interruption and concurrency behavior remain unverified against MongoDB.

Process-local auth/AI/upload rate limits and AI in-flight state reset on restart and do not form distributed limits. Stay on one backend process, monitor Gemini account quotas and do not promise restart-proof abuse budgets. Cold starts may produce delayed or non-JSON responses; existing client handling reports failures, and acceptance must verify this on Render. Do not add automatic retry of arbitrary clinical mutations. No free-tier availability or data-corruption-free operation is claimed without the deferred real tests.

## Public access and security review

- Existing signup/login is email/password; bcrypt hashing, JWT expiry/HS256 verification, server-side session version checks and disabled-account enforcement remain intact. Doctor professional approval and role/ownership checks remain mandatory.
- Public signup offers patient/doctor roles, not administrator. Newly registered doctors remain pending. Administrator credentials must stay private. CORS is not an authentication boundary; backend ACLs still apply to direct clients.
- Existing admin bootstrap is explicit (`--confirm-bootstrap`), never a startup hook; it refuses to elevate another role and does not create a second administrator when one already exists. No public demo-admin access route or credential was introduced.
- The repository has a presentation runbook and a development doctor seed, not a verified public demo-account provisioning workflow. The seed is blocked in production, marks accounts `isDemo=true`, and those profiles are intentionally excluded from discovery. Do not weaken that filter or run seeds to make recommendations appear.
- Use normal signup plus private administrator approval and availability setup for owner-approved synthetic demonstration clinicians after write approval. Visitors may use their own synthetic patient signup; private doctor/admin walkthroughs can be supervised or recorded. Do not publish shared privileged accounts.
- **Synthetic-only database contents are Not Verified.** No Atlas data was accessed. There is no universal demo-mode enforcement preventing users from typing personal data. Owner review of the target database and a clear synthetic-only audience instruction are release gates. An existing database with unknown contents is not cleared for public use.
- Existing Helmet, body limits, auth throttling, AI protection and safe error logging were inspected. Startup and central errors avoid dumping credentials/request payloads. Safe tests cover approval/ownership, session revocation, errors and secret logging. This is not an exhaustive penetration test or dependency vulnerability audit.
- Ignore-rule tests cover environment variants, keys, certificates, uploads and generated data; examples remain trackable. This workspace lacks `.git` metadata, so tracked secrets/history are **Not Verified**. Review the actual publishing repository privately, and rotate any previously exposed secret; ignore rules do not remove history. No existing secret values were inspected.
- With email disabled there is no self-service email password recovery. Do not invent manual reset links, shared passwords or administrator impersonation as substitutes. Signup does not assert verified email ownership.

## Confirmed issues and changes

1. Missing Vercel SPA routing configuration: added the documented rewrite in `frontend/vercel.json`, plus a safe regression test of its exact configuration and deep-link patterns.
2. Outdated `DEMO.md` instructed seed/OTP usage and file upload on an unsuitable host: updated preparation and smoke checks for current authentication, private bootstrap, approved synthetic data and disabled binaries.
3. Prior Phase 7 host instructions targeted a Render static frontend: this report supplies the selected Vercel/Render split without altering working runtime behavior.

Files modified in this task: `frontend/vercel.json` (new), `frontend/tests/deploymentConfig.test.mjs`, `DEMO.md`, and this `DEPLOYMENT_READINESS_REPORT.md` (new). No backend runtime files, database schemas, authentication or environment files changed.

## Safe verification results

Results are recorded after the safe runs below; no legacy HTTP integration test or real database suite was executed.

- Backend: `npm test` invokes the existing explicit safe allowlist; **347 passed, 0 failed**.
- Frontend: `npm test`; **66 passed, 0 failed**, including the new hosting configuration regression.
- Frontend lint: `npm run lint` passed.
- TypeScript: `tsc -b` passed.
- Production bundle: passed with Vite `build({envDir:false})` and process-only `VITE_API_URL=https://backend.example.test`; local environment files were not loaded.
- The verification bundle deliberately targets a synthetic origin. Do not upload it as the configured production artifact; Vercel must rebuild with the actual public backend origin.

Mock/loopback tests verify configuration validation, CORS, health state changes, proxy semantics, disabled upload paths, authorization and transaction service behavior. They do not verify Vercel's edge, Render connectivity, real Atlas indexes/transactions or live Gemini. No packages were installed and no application server was started against the normal configuration.

## Deployment sequence — instructions only, not executed

1. Privately review source control for secrets and confirm a synthetic-only, isolated database on the existing Atlas cluster. Do not reuse unreviewed records. Approve first-start/index writes explicitly. Resolve the remaining transaction test gate or explicitly document it before a restricted demonstration; do not claim verified clinical concurrency.
2. Run the safe checks above in the release checkout. Confirm lockfiles are committed. Do not run `test:integration`, seeds, migrations or reconciliation as deployment hooks.
3. Reserve the frontend project/service names to determine the exact Vercel and Render HTTPS origins. Keep automatic deployment off until the owner authorizes deployment. Configure Render settings and secret values privately; do not submit/deploy as part of this preparation task.
4. After deployment approval, create the isolated Atlas database user/network access and configure Render's actual outbound ranges. Use the existing cluster only with the approved named demo database. Keep binary uploads/email off and provider quotas bounded.
5. Deploy the single Render service with the settings above. Stop on index/topology failures; do not delete duplicate records to force startup. Verify HTTPS `/api/health`, exact-origin CORS preflight and nonallowed-origin denial. Verify proxy-hop handling privately before public access.
6. Deploy Vercel from `frontend` with the actual Render origin. Confirm `/patient/appointments`, `/doctor/dashboard`, `/admin/dashboard` and `/notifications` refresh to the SPA and then honor real role guards. Confirm static assets, HTTPS and API requests; no mixed-content/localhost calls.
7. If no private admin exists, only after separate database-write approval run the existing `npm run bootstrap:admin -- --confirm-bootstrap` from `backend` in a clean trusted checkout with no local `.env`, supplying the approved URI and temporary `ADMIN_*` values through a private process environment. Render Free does not offer shell/one-off jobs. Temporarily allow only the operator's IP if needed, remove it afterward, and clear bootstrap process secrets. Do not add a bootstrap web route, expose credentials or put bootstrap in build/start. If an admin already exists, use it privately; do not overwrite it.
8. With separate synthetic-write approval, create test patient/doctor accounts through existing signup, approve only the intended demonstration clinicians privately, configure availability, and verify booking/consultation/prescription/notifications. No fabricated record import or public admin password is necessary. Ensure synthetic-only messaging is clear to visitors.
9. After explicit approval for provider calls, run the synthetic Gemini acceptance plan in `backend/PHASE7_DEPLOYMENT.md`: specialty differentiation, empty matches, local emergency guidance, failure/timeout, quota and injection resistance. No real patient inputs.
10. Verify cold wake/restart and uncertain-response recovery in the approved staging dataset, ownership denials, suspension/session refresh, disabled email recovery, disabled binary uploads and readable errors. Inspect browser console/network without exporting sensitive HARs.
11. Before linking the public portfolio, complete the gates below, check free-plan usage limits and preserve a private rollback/backup plan. Code rollback does not roll back committed database records. Do not attach paid services or enable billing upgrades as a workaround.

## Remaining blockers and exact next task

1. Owner confirmation that the named Atlas demo database is isolated and contains synthetic data only; actual credentials/network/index rights remain unverified.
2. Actual Vercel/Render origins, CORS, trusted-proxy chain, cold-start behavior and browser acceptance remain unverified.
3. Real MongoDB transaction/index/concurrency/rollback tests remain deferred. No Docker/mongod installation or service startup was authorized; the existing disposable harness and Phase 7 plans remain the route to verification. Never run it against Atlas. Admin real rollback/revocation extensions described in Phase 7 are also pending.
4. Live Gemini quota/model availability and synthetic safety acceptance remain pending explicit provider-call approval.
5. Publishing repository history and any legacy file dependencies require private review. Public patient signup cannot technically guarantee every input remains synthetic.
6. Free-tier storage, email recovery, restart-reset rate budgets and cold-start availability are intentional limitations, not completed production capabilities.

**Next task:** owner review/approval of this report and the isolated synthetic demo database plan, then provision/approve the disposable replica-set verification environment. Actual hosting deployment is a separate explicitly authorized step. This report prepares the project for controlled staging, not an unconditional production-readiness certification.
