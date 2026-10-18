# MediFlow AI

React + TypeScript + Express + MongoDB healthcare workflow portfolio project with patient, approved-doctor and administrator portals. AI provides educational/documentation assistance and does not replace professional care or emergency services.

## Current workflows

- Patients sign up/sign in with email and password; email OTP is optional, not mandatory.
- Doctors register professional details and require administrator approval before clinical access or booking eligibility.
- Recommendations select canonical specialties; doctor profiles and available slots come only from the database.
- Booking, rescheduling, cancellation, completion, amendments and admin decisions use transaction safeguards. MongoDB replica-set transaction verification remains pending.
- Medical records use authorized private file access and recoverable storage receipts. Ephemeral demo hosting must disable binary uploads; text records remain available.
- Notifications are in-app by default. Optional email recovery requires explicit configuration. Scheduled reminders/health-tip delivery are not implemented.

## Local development

Use Node 24.x (the tested runtime). Install dependencies with npm ci in backend/ and frontend/. Configure your own untracked environment files using the sanitized examples; never overwrite existing files. MongoDB transactions require a replica set, not a standalone server. The isolated destructive/failure-test harness has its own independent configuration.

- Backend: from backend/, npm start (development reload: npm run dev).
- Frontend: from frontend/, npm run dev.
- Frontend VITE_API_URL is a public API origin. Local fallback is http://localhost:5000; production requires an explicit HTTPS origin or deliberately configured same-origin proxy.
- First administrator: explicitly configure ADMIN_EMAIL, ADMIN_NAME, ADMIN_PHONE, ADMIN_PASSWORD and the approved demo MONGO_URI privately, then invoke npm run bootstrap:admin -- --confirm-bootstrap. This writes to the chosen database; never run it against existing data without approval.

No seed, migration, bootstrap or database service starts automatically.

## Safe verification

From backend/: npm test or npm run test:safe. Both now use an explicit safe allowlist. The legacy test:integration command is destructive and must never target existing databases; a URI containing the word test is not adequate isolation.

From frontend/: npm test, npm run lint, npm run build. Production builds require VITE_API_URL to be configured. Vite normally loads local environment files; the Phase 7 report documents how verification was performed without loading them.

Disposable real transaction verification is separate: see [the isolated harness instructions](backend/tests/transactions/README.md). Its configuration check makes no connection; mutation requires explicit confirmation, dedicated local servers and provisioned markers. Docker/mongod remain unavailable on the inspected machine, so real integration is pending.

## Deployment

Follow [Phase 7 deployment readiness and verification](backend/PHASE7_DEPLOYMENT.md) for exact hosting settings, environment templates, storage limitations, SPA rewrites, trusted-proxy configuration, health checks, integration/Gemini plans and release gates. No deployment or real-provider success is claimed.

Free ephemeral hosting can demonstrate synthetic workflows with MEDICAL_UPLOADS_ENABLED=false; it cannot safely retain private medical files. Do not use real patient data in a portfolio demo. In-app polling, partial UI translation and browser printing remain the existing supported contracts; no compliance certification or legal prescription signature is claimed.

Detailed prior reports: backend/PHASE3_SCHEDULING.md, backend/PHASE4_MEDICAL_RECORDS.md, backend/PHASE5_AI_RELIABILITY.md and backend/PHASE6_PORTAL_COMPLETION.md. Statements about old test commands in historical reports describe their implementation phase; use the current safe scripts above.
