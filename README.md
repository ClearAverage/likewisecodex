# Likewise

A responsive, white-background classroom matching website using the supplied red/charcoal Likewise branding. The frontend runs on GitHub Pages; Firebase Authentication, Cloud Functions, and Cloud Firestore power the app.

## Start here

1. Follow [Firebase setup](docs/FIREBASE_SETUP.md).
2. Read [Firestore rules and security design](docs/FIRESTORE_RULES.md).
3. Follow the GitHub Pages section of the setup guide to publish the frontend.
4. Check [verification and launch notes](docs/TESTING.md) before inviting students.

The project is built and tested locally. It has **not been deployed** to your Firebase project or to GitHub. Your Firebase web configuration is already included. You still need a reCAPTCHA Enterprise site key, project setup, and deployment. This repository does not contain Firebase Admin credentials.

## Included

- Email/password sign-up and sign-in, verification email, password reset, password change, session-scoped sign-in, and account deletion with reauthentication.
- One active classroom per person, up to 60 participants including the host.
- Private 10-character codes, host-approved join requests, and a roster that locks when the round starts.
- A fixed results time between 24 hours and 30 days after classroom creation.
- One private choice per person, changeable or removable before the deadline; sitting out is supported.
- Mutual-only results, including the exact fallback: **No mutual match this round.**
- Classroom access expires 72 hours after results. A scheduled function removes expired classroom records and code indexes every 15 minutes.
- Phone, tablet, and desktop layouts; keyboard-friendly dialogs; scroll reveals; pointer movement and floating accents; reduced-motion support.
- Original envelope artwork, local fonts, supplied logos, GitHub Actions deployment, Firebase security rules, and emulator tests.

## Product choices

The initial audience is classmates aged **13–17**. Participation is voluntary, including joining and choosing. The age checkbox is self-declaration, not identity/age verification. The host checks classmates in person before admitting them. No chat, freeform posts, uploads, public profiles, rankings, crush counts, or one-sided reveal features are included.

A classroom may start without every student; no one should have to join. The host cannot extend or shorten a deadline after creation. A lobby that never starts still expires three days after its planned results time. Results are computed on demand from locked choices; no scheduled reveal job is required.

## Local development

Requires Node.js 22 and npm. Use Java 21+ for Firebase emulators.

```sh
npm ci
npm ci --prefix functions
cp .env.example .env.local
npm run dev
```

PowerShell users can use `Copy-Item .env.example .env.local` instead of `cp`.

Without App Check configuration, the public design and authentication forms render, but protected classroom requests fail closed with a setup message. For a complete local test without production access, follow the emulator section in the setup guide.

```sh
npm test
npm run test:emulator
npm run build
```

Only `dist/` is published to Pages. The entire repository source belongs in GitHub, including the hidden `.github/` directory. Do not upload `node_modules`, local `.env` files, emulator logs, service accounts, or generated debug output. The supplied clean delivery folder excludes these.

## Structure

```text
.github/workflows/pages.yml   GitHub Pages build, checks, deployment
src/                         React app, Firebase client, responsive styling
public/                      Supplied logos and original envelope artwork
functions/                   Server-only classroom logic and cleanup job
firestore.rules              Deny all direct client database access
firestore.indexes.json       Index exclusions and TTL policies
firebase.json                Firebase deployment and emulator configuration
tests/                       Unit tests, emulator integration, local demo seeding
docs/                        Setup, security, research, and verification guides
```

## Security in one sentence

The browser never receives the complete classroom document: every database operation goes through an authenticated, production App Check protected server function that returns an explicit per-user projection.

Authorized Firebase project administrators can technically access stored choices. The system is not end-to-end encrypted. Limit project IAM access and do not grant students console roles. No application can prevent someone from showing their own result or screenshot to another person.

## Assets

The Likewise lockup and symbol were supplied by the project owner. `public/envelopes.png` is an original AI-generated image for this build. DM Sans and Manrope are distributed through Fontsource under the SIL Open Font License; their licenses are included in their npm packages. Lucide icons use the ISC license. Dependencies are recorded in the lockfiles.
