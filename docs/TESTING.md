# Likewise — verification and launch notes

## Completed locally

- Production build with Vite.
- Eleven domain tests covering private projections, mutual-only matches, exact deadline/expiry boundaries, outsiders, self-selection, host restrictions, withdrawals, pending-member privacy, start conditions, clearing, and input validation.
- Firebase Auth/Firestore emulator integration covering the complete classroom lifecycle and direct database denial. The suite includes real Firebase SDK verification-email and password-reset actions: it generates each action, applies the verification code, changes the test password through the reset code, rejects the old password, and accepts the new one.
- Transaction checks for simultaneous choices and concurrent classroom creation.
- Live-account checks for disabled, unverified, and revoked sessions.
- Browser checks using fictional local accounts: host lobby, starting a round, choosing, saving, reload persistence, and results-phase classroom navigation.
- Responsive desktop and phone inspection; fixed hero overflow and mobile heading wrapping. Tablet uses the same responsive breakpoints.
- Sign-in and password-reset dialog navigation.
- Production dependency audits: root `npm audit --omit=dev` and backend `npm audit` reported zero vulnerabilities at verification time.

## Email verification investigation

The original visible preview at port 5174 used Firebase emulators. The Authentication emulator does **not** send real emails. It produces local action links; the missing inbox message was expected in that environment. Test mode now has a prominent banner and email messages explicitly state that no email was sent.

The Firebase client, CLI project alias, and setup instructions were switched to the supplied **likewisecodex** project. Its public Authentication configuration was fetched successfully (HTTP 200), and `localhost` is authorized. The live-project preview is `http://localhost:5173/`.

The automated SDK flow verifies that the code requests and processes valid verification and password-reset actions. This proves the application flow in emulation; it does not prove inbox delivery by the live project. Real delivery, spam filtering, sender/template settings, and quotas must be checked using an address you own. The UI now says Firebase accepted the request, rather than claiming confirmed delivery, and displays actionable failure messages.

Verification remains enabled because it is a key defense against easy impersonation and the identified missing-mail cause was emulator mode. If the live project fails to deliver after configuration checks, inspect the reported Firebase error and mail settings before weakening this protection.

## Not yet verified in production

- Firebase function deployment and actual project IAM.
- App Check registration and enforcement using the real website domain.
- Real inbox delivery for verification/reset emails.
- Cloud Scheduler execution and TTL policy activation.
- GitHub Actions/Pages deployment and production custom domain.

No production classrooms were created by the build tests. Synthetic fixtures and accelerated results were confined to `demo-likewise` emulators.

## Development tooling advisories

The installed Firebase CLI has upstream development-only dependency advisories. At audit time the full root audit reported 11 (7 high, 4 moderate), involving tooling dependencies including `braces`/`chokidar`, proxy/FTP utilities, OpenTelemetry, and UUID usage. These packages are not bundled into the website or deployed in the Functions directory. The standalone backend audit and production frontend dependency audit were clean.

Do not run a blind `npm audit fix --force`: the suggested changes can downgrade or break Firebase tooling. Keep the lockfiles, update the CLI when upstream fixes are available, and rerun tests after dependency changes. The root manifest includes a patched gRPC override to address its reported advisory.

## Reproduce

Use Node.js 22 and Java 21+:

```sh
npm ci
npm ci --prefix functions
npm test
npm run test:emulator
npm run build
npm audit --omit=dev
npm audit --prefix functions
```

Stop an existing emulator suite before `npm run test:emulator`; the command starts its own Auth and Firestore emulators. The integration test refuses to run without emulator endpoints. `tests/seed-demo.mjs` is only for local browser fixtures; adding `--reveal` advances that fictional classroom to mutual-match results. It refuses to run without explicit local emulator addresses.

## Final launch checks

Use the detailed checklist in `FIREBASE_SETUP.md`. In particular: do not launch without the backend deployed, deny-all rules active, App Check configured, real email delivery tested, cleanup running, a monitored support contact, and the school/operator’s participation process in place.
