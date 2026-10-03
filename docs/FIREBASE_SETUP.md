# Likewise — complete Firebase and GitHub Pages setup

This guide matches the delivered code. Your project is `likewisecodex`. The website has not yet been deployed. You do not need to manually create Firestore collections: the server creates documents when the first verified student sets up a profile and creates or joins a classroom.

## 1. Accounts, tools, and billing

- Access to the Firebase / Google Cloud project as its owner or a suitably authorized deployment administrator.
- A GitHub account and repository for the frontend.
- Node.js **22** and npm on the deployment machine.
- Java **21 or later** to run the test emulators.
- Firebase **Blaze** billing enabled for Cloud Functions and scheduled cleanup. Configure Google Cloud budget alerts; alerts do not enforce a hard spending cap.

Firebase Authentication and Firestore have usage-based limits. Cloud Functions, Scheduler, App Check/reCAPTCHA, and database operations can incur charges. Check current pricing for your region and usage before launch. The functions are capped at 10 instances each; this limits scaling but is not a cost guarantee.

Install the project dependencies from the repository root:

```sh
npm ci
npm ci --prefix functions
npx firebase login
npx firebase use likewisecodex
```

The Firebase CLI is a pinned development dependency. Do not create, download, or commit a service-account JSON file for the browser or GitHub Pages. Firebase CLI authentication stays on your own machine.

## 2. Configure email/password Authentication

In Firebase Console, open **Build → Authentication** and initialize it if necessary.

1. In **Sign-in method**, enable **Email/Password**. Email-link sign-in is not required. Do not enable anonymous sign-in for this app.
2. In Authentication settings, set the password policy to **Require**, minimum **12 characters**, with uppercase, lowercase, numeric, and non-alphanumeric requirements. Enforce the policy for account creation and password changes. The app’s length checks are only a convenience; Firebase must enforce the real policy.
3. Enable **email enumeration protection** in the Authentication / Identity Platform project settings if it is not already enabled. The reset form always gives the same success message, but server configuration is still necessary to limit account discovery through the public Auth API.
4. Review the password maximum in the project policy; never collect or store plaintext passwords in Firestore.
5. Review Authentication quotas and abuse protections. App Check protection on the callable function does not, by itself, protect every public Authentication endpoint.

### Authorized domains

Add the actual website hostname under **Authentication → Settings → Authorized domains**:

- For a project Pages site: `YOUR-GITHUB-USERNAME.github.io` (no `https://` and no repository path).
- Add any custom domain you configure later.
- Add `localhost` or `127.0.0.1` only if you deliberately test against the live project. Prefer emulators for development.

### Verification and password reset emails

In **Authentication → Templates**, customize **Email address verification** and **Password reset** with the Likewise name, a suitable sender name, and your actual support address. Retain Firebase’s required action-link placeholders.

This implementation uses Firebase’s hosted action handler, normally on `likewisecodex.firebaseapp.com`. Keep that handler enabled. Do not change its action URL to the static GitHub Pages site: this frontend does not implement its own `oobCode` action handler. Students open the email link, complete the Firebase-hosted action, and return to Likewise.

Yes: Firebase sends password-reset and verification emails for this flow. You do not need SendGrid, a custom mail server, or the Trigger Email extension. Delivery quotas still apply. Test with real addresses you own before launch.

Verified students can change their password in **My account** after entering their current password. Account deletion requires recent reauthentication. Sessions use browser session storage instead of persistent local sign-in.

## 3. Create Cloud Firestore

In **Build → Firestore Database**, create the **default** database in **Native / Standard mode**. Select **production mode**, not test mode.

Choose the region deliberately; it affects latency, residency, and cost and is not a casual later change. The delivered functions use `us-central1`. A nearby compatible Firestore region is a practical starting point. If you change the function region, update both `functions/index.js` and `src/firebase.js` before deployment.

Do not create Realtime Database. All application records live in Firestore. Firebase Authentication stores credentials separately, as intended by Firebase.

Deploy the rules and index configuration:

```sh
npx firebase deploy --only firestore:rules,firestore:indexes --project likewisecodex
```

The rule file intentionally denies all browser reads and writes. This is correct: the app uses server callables, and the Firebase Admin SDK validates each operation in server code. Never replace the file with `allow read, write: if request.auth != null`.

### Retention configuration

`firestore.indexes.json` includes TTL policies on `expiresAt` for:

- `rateLimits`: abuse-prevention counters, expiring about 48 hours after their latest update.
- `profiles`: only content-free account-deletion guards have this timestamp. Normal profiles do not, so they do not expire automatically.

After deployment, verify both TTL policies show enabled in Google Cloud Firestore’s TTL settings. If your CLI or project requires enabling them in the console, choose those exact collection groups and the `expiresAt` timestamp field. Firestore TTL is asynchronous and can take roughly 24 hours after expiration; it is not used to enforce classroom access.

Do **not** add a TTL policy to `classes` without changing cleanup logic: deleting that document independently could orphan its code record. Classrooms and their code indexes are removed together by the scheduled function. Sensitive maps have automatic indexing disabled because they are never queried.

## 4. Configure Firebase App Check

The deployed callable requires a valid App Check token. Do this before testing live classrooms.

1. In Google Cloud / Firebase App Check, create a **reCAPTCHA Enterprise website key** for the actual Pages hostname and any custom domain. Use a score-based website integration supported by Firebase App Check.
2. Register your existing Firebase web app with the **reCAPTCHA Enterprise** provider in **Build → App Check**.
3. Copy the public reCAPTCHA Enterprise **site key**, not an API secret or service-account credential.
4. Add it as `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` in local `.env.local` for intentional live-project tests and as a GitHub Actions repository **variable** for the public build.
5. Review App Check metrics and register every legitimate hostname. The function uses `enforceAppCheck: true` in production. Requests without an accepted token must fail.

The web API key in `src/firebase.js` and the reCAPTCHA site key are public identifiers. Neither is a substitute for authentication or database security. Review Firebase’s API-key restriction guidance, but do not indiscriminately lock the web key to an API list that breaks Auth or App Check.

For local development, prefer the emulators below. Do not ship a debug App Check token, disable production enforcement, or put an emulator flag in a production build. A local CLI-provided `FUNCTIONS_EMULATOR=true` is the sole server-side enforcement exception. Browser request data cannot disable App Check.

## 5. Deploy the backend

Run the local checks first:

```sh
npm test
npm run test:emulator
npm run build
```

Then deploy from the repository root:

```sh
npx firebase deploy --only functions --project likewisecodex
```

Allow Firebase to enable the required Google Cloud APIs when prompted. The deployment creates:

| Function | Purpose |
| --- | --- |
| `likewise` | Authenticated callable for profiles, admission, choices, results, and deletion |
| `removeExpiredClasses` | Scheduler-triggered deletion of expired classes and code indexes every 15 minutes |

Callable functions must be network-invocable by browsers. Their application authorization is implemented through Firebase Auth, App Check, live account checks, and server validation; changing Cloud Run IAM to disallow all browser invocation will break the app. Do not loosen the application checks to work around a deployment issue.

Give the runtime service account only the access it needs for Firestore data operations and Firebase Auth user lookup/deletion. The deployer needs the roles required by Firebase for function and Scheduler deployment. Do not give students or hosts Google Cloud roles. Restrict project owner access and require MFA on administrator accounts.

Check **Cloud Scheduler** for the cleanup job and confirm it can invoke its function. Review execution logs without printing request data. Set an alert on repeated failures. Cleanup retries three times; backlogs over 2,000 expired classes are handled by subsequent runs.

## 6. Publish the frontend on GitHub Pages

Create a GitHub repository and upload **the contents of the supplied GitHub-ready folder** at its root. Include `.github`, `.firebaserc`, `.gitignore`, and `.env.example`; GUI file pickers sometimes hide dotfiles.

Do not upload `node_modules`, `.env.local`, service-account JSON, emulator exports, or logs. These are omitted from the clean delivery folder and ZIP.

1. Use a branch named `main` (or change the branch in `.github/workflows/pages.yml`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. In **Settings → Secrets and variables → Actions → Variables**, add:

   | Repository variable | Value |
   | --- | --- |
   | `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | The public Enterprise website key from step 4; required |
   | `VITE_SUPPORT_EMAIL` | Your real privacy/safety contact email; strongly recommended |

4. Do not add `VITE_USE_EMULATORS=true` to GitHub. It is local-only and also guarded by Vite’s development flag.
5. Push to `main` or run **Publish website to GitHub Pages** under Actions.

The workflow installs locked dependencies, runs unit and emulator tests using Java 21, verifies the App Check key is set, builds the app, and deploys only `dist/` to Pages. It never deploys backend changes or receives Firebase administrator credentials.

Vite uses a relative asset base and the app uses hash navigation, so `/REPOSITORY/#classroom` and `/REPOSITORY/#results` work without server rewrites. Use the published Pages URL, not a GitHub source-file URL.

The Pages build deliberately fails if the App Check site key variable is missing. Changing a `VITE_` variable requires a fresh build; it is compiled into the static site.

For a custom domain, configure it in GitHub Pages and DNS, enable HTTPS, then add that hostname in Firebase Authorized domains and reCAPTCHA Enterprise. A redirect to a different hostname also needs the appropriate configuration.

## 7. Local emulators: no production writes

Install Java 21+ and ensure `java -version` reports that version in the terminal where you run Firebase.

Terminal 1:

```sh
npx firebase emulators:start --project demo-likewise --only auth,firestore,functions
```

Copy `.env.example` to `.env.local` and set:

```dotenv
VITE_USE_EMULATORS=true
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=
```

Terminal 2:

```sh
npm run dev
```

Only a Vite development build honors this emulator flag. The client uses the reserved demo project ID; services outside the emulator cannot reach your real Firebase project.

To seed a synthetic classroom for manual browser checks in PowerShell:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
node tests/seed-demo.mjs
```

The script prints a local-only sign-in and creates eight fictional classmates. Its guard refuses to run without the local emulator addresses. Never use these fixture credentials for a real account. The Functions emulator bypasses App Check locally, but authentication and every other authorization check still run. Add `--reveal` to seed mutual-match results for UI inspection.

**The Authentication emulator never sends real email.** Verification and reset links appear in its terminal output / local emulator tools. The app displays a test-mode banner and does not claim that a real message was delivered. To test real mail, unset `VITE_USE_EMULATORS`, restart Vite, and use an account in `likewisecodex`. Emulator accounts do not exist in the live project.

For automated tests, stop running emulators first, then run `npm run test:emulator`. The test command starts its own Auth and Firestore emulators, runs tests, and shuts them down. The scheduled job is tested by directly invoking its cleanup service; the actual scheduler timing must be checked after deployment.

## 8. Before inviting students

- Add a real support contact and make sure it is monitored.
- Review school participation requirements, applicable youth/privacy requirements, and who operates the service. This code is not an age-verification service or a complete school policy.
- Test verification and reset links using addresses you own. Confirm Firebase’s password policy is enforced by the API, not just the UI.
- Use at least three test users to confirm one mutual pair and one non-mutual outcome. Use emulators for accelerated deadlines; do not weaken production deadlines for convenience.
- Inspect browser network responses: choices maps, other students’ emails, and one-sided results must never appear.
- Confirm bad/missing App Check tokens, unverified accounts, and direct Firestore requests are rejected.
- Confirm cleanup actually runs in Cloud Scheduler, and keep monitoring it.
- Review IAM, budget alerts, log retention, and backup settings. Removing live records does not purge existing backups.
- Run `npm audit --omit=dev` at the root and `npm audit` in `functions`. Recheck tooling advisories periodically.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| “Classrooms are not open yet” | The build has no App Check site key. Add the repository variable and rebuild. |
| Sign-in works but classroom requests fail | Deploy the callable, check its region, verify email, and inspect App Check domain/key registration. |
| `auth/unauthorized-domain` | Add the exact deployed hostname in Firebase Authentication authorized domains. |
| Reset email is missing | Check the email address, spam folder, templates, sender settings, and Firebase mail quota; the UI intentionally avoids confirming account existence. |
| Firestore SDK returns permission denied | This is intentional. Use the application callable; never relax the rules. |
| `failed-precondition` when starting | Review pending requests, admit at least two participants, and start at least one hour before the deadline. |
| A blank Pages site or missing assets | Upload repository contents at root, use Actions as the Pages source, and check the build logs. The published artifact must be `dist/`. |
| Emulator needs a newer Java version | Install Java 21+ and update your terminal’s `JAVA_HOME` and `PATH`. |
| Classroom data remains after expiration | Access is already denied; check Scheduler and function errors. Physical deletion is asynchronous. |
| Deletion partly failed | Retry after reauthentication. The content-free deletion guard prevents further participation; an administrator can finish Auth deletion if necessary. |

## Official references

- [Firebase: managing users, verification and reset emails](https://firebase.google.com/docs/auth/web/manage-users)
- [Firebase: email/password authentication and password policies](https://firebase.google.com/docs/auth/web/password-auth)
- [Firebase: callable functions](https://firebase.google.com/docs/functions/callable)
- [Firebase: App Check with reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
- [Firebase: App Check enforcement for functions](https://firebase.google.com/docs/app-check/cloud-functions)
- [Firebase: scheduling functions](https://firebase.google.com/docs/functions/schedule-functions)
- [Firestore: TTL behavior](https://firebase.google.com/docs/firestore/ttl)
- [GitHub: custom workflows for Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
