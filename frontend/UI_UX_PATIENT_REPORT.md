# Shared design system and Patient Portal modernization

Scope: shared design foundation and Patient Portal only. Doctor, Admin, authentication and landing page redesigns are deferred. Shared tokens, navigation, dialogs and feedback also affect those existing portals.

## Page inventory and audit

| Area | Pages inspected | Result in this increment |
| --- | --- | --- |
| Patient | Dashboard, AI chat, appointments and booking, prescriptions, medical records, consultation history, profile, settings, safety profile | Presentation updated; existing API operations retained |
| Shared | Notifications, Not Found; ErrorBoundary and protected-route states | Notifications updated; error and authorization behavior retained |
| Doctor | Dashboard, appointments, consultation workspace, availability, profile, pending approval | Inventory complete; page redesign deferred |
| Admin | Dashboard, users, doctor applications, appointments, analytics, audit logs, settings | Inventory complete; page redesign deferred |
| Authentication | Signup, login, OTP, forgot password | Inventory complete; page redesign deferred |
| Public | Landing | Inventory complete; redesign deferred |

The audit found inconsistent form spacing and typography, small secondary labels, nested main landmarks, missing safety-field labels, no skip link, and incomplete keyboard containment/restoration in dialogs and mobile navigation. Busy confirmations could be dismissed. Safety-profile line normalization on each keystroke interfered with multiline editing. These issues were addressed without removing functional controls.

## Design system

White and soft-slate surfaces, navy text, blue primary actions and restrained teal accents now share tokens. Shared primitives cover buttons, cards, headings, status badges, notices, loading and empty states, tables, confirmation dialogs and toasts. Navigation uses the current account and route; displayed clinical data remains API-backed.

Inputs and key actions have comfortable touch sizes. Mobile navigation traps focus, supports Escape, restores its opener and makes background content inert. Confirmation dialogs use unique accessible labels, focus containment and busy-state protection. The workspace has a skip link and one main landmark. Tables scroll locally, cards wrap on small screens, and motion respects reduced-motion settings. These are implemented improvements, not a claim of WCAG certification.

## Patient workflows retained

- Dashboard: real metrics, next appointment and navigation actions; truthful loading, empty and error states.
- AI chat: existing request lifecycle, language selection and chat preserved; educational/emergency guidance and AI-versus-local safety labeling remain visible.
- Booking: concern, doctor, slot and review steps; existing discovery, availability, request IDs, version checks, rescheduling and cancellation retained. Device-timezone interpretation is stated.
- Records: upload capability restrictions, filtering, view, download and confirmed deletion retained.
- Prescriptions and consultation history: original clinical content, amendments, void warnings and print action retained.
- Profile and safety profile: existing payloads retained; safety text is normalized only when saved.
- Settings and notifications: preference persistence, signout, read actions, details and pagination retained. Disabled demo reminder delivery is disclosed.

## Modified files

All paths are relative to `frontend/`:

- `src/index.css`
- `src/components/ui/Core.tsx`
- `src/components/ui/useDialogFocus.ts` (new)
- `src/components/ui/ConfirmDialog.tsx`
- `src/components/ui/Toast.tsx`
- `src/components/layout/PortalShell.tsx`
- `src/components/layout/PatientShell.tsx`
- `src/pages/patient/DashboardPage.tsx`
- `src/pages/patient/AIChatPage.tsx`
- `src/pages/patient/AppointmentsPage.tsx`
- `src/pages/patient/MedicalRecordsPage.tsx`
- `src/pages/patient/PrescriptionsPage.tsx`
- `src/pages/patient/ConsultationHistoryPage.tsx`
- `src/pages/patient/ProfilePage.tsx`
- `src/pages/patient/SettingsPage.tsx`
- `src/pages/patient/SafetyProfilePage.tsx`
- `src/pages/shared/NotificationsPage.tsx`
- `tests/patientUi.test.mjs` (new)
- `package.json`
- `UI_UX_PATIENT_REPORT.md` (new)

## Verification

- Frontend tests: **33 passed, 0 failed**, including 20 new patient/shared UI tests.
- TypeScript: `tsc -b` passed.
- Lint: `npm run lint` passed.
- Production build: passed using Vite `envDir: false` and a synthetic HTTPS API origin; existing environment files were not loaded or changed.
- Tests mount actual components with React StrictMode and synthetic fetch fixtures. They cover all ten patient-facing pages, focus and Escape behavior, mobile navigation, profile and safety payloads, preferences, prescription content/print, record controls, notification ownership endpoint and appointment-management controls. They do not prove live API or database behavior.
- Backend unchanged; the previously reported 347 backend tests were not rerun for this frontend-only increment.

No live database operations, live Gemini calls or real patient data were used. No environment files were read or changed.

## Remaining verification and next phase

The computer-use inventory exposed no browser, and creating an in-app browser returned unavailable. Consequently no screenshots, real viewport layout inspection, device testing, screen-reader testing or real print preview were performed. Automated DOM checks do not establish absence of every visual overflow or contrast issue.

Review the Patient Portal in a real browser at desktop, tablet and mobile widths (for example 1440, 768 and 390 pixels). Check keyboard-only navigation, dialogs, long clinical text, empty/error states, booking/rescheduling, uploads where enabled and print preview using an authorized test environment. Confirm no console errors and no horizontal page overflow. Existing real MongoDB concurrency verification remains deferred.

Stop for Patient Portal review before proceeding. The next implementation phase is Doctor Portal modernization using this shared foundation, followed separately by Admin and authentication pages.
