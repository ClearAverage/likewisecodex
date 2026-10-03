# Likewise — full Firestore rules and security design

## Complete production rules

The authoritative deployable file is `firestore.rules` in the repository root:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Every app operation goes through authenticated, App Check protected
    // Cloud Functions. Admin SDK bypasses these rules and validates each action.
    // Never grant clients reads of class documents: they contain private choices.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Deploy with:

```sh
npx firebase deploy --only firestore:rules,firestore:indexes --project likewisecodex
```

Alternatively, paste the complete rules into **Firebase Console → Firestore Database → Rules** and publish. Deploy indexes and TTL configuration separately if using the console for rules.

## Why deny everything?

Firestore rules authorize whole documents; they do not redact fields. Letting members read a class document would expose its private choices. Hiding those fields in React would not protect them.

Likewise uses a server-only database. The browser calls the `likewise` HTTPS callable, which reads Firestore using the Admin SDK and returns a limited response. There is no browser Firestore listener or persistent database cache. Changing browser code, guessing document paths, or claiming to be a host cannot override these rules.

The Admin SDK bypasses Firestore rules. **The server code and project IAM are security boundaries too.** Rules alone are not a complete installation. Deploy the supplied functions and keep administrative credentials out of GitHub and the browser.

## Data model

All application records use the default Firestore database. Authentication credentials remain in Firebase Authentication. There are no subcollections holding crush data.

| Document | Fields | Direct client access |
| --- | --- | --- |
| `profiles/{authUid}` | `name`, `consentVersion`, `createdAt`, `classroomId` | None |
| `classes/{randomId}` | `id`, `name`, `hostId`, `status`, `revealAt`, `expiresAt`, `createdAt`, `code`, `members`, `pending`, `blocked`, `choices` | None |
| `codes/{sha256(code)}` | `classroomId`, `expiresAt` | None |
| `rateLimits/{uid_bucket}` | `count`, `until`, timestamp `expiresAt` | None |

`members` and `pending` map UIDs to classroom display names. `choices` maps a choosing UID to exactly one target UID. React escapes names and other displayed values; the app never renders user-supplied HTML.

After account deletion, the profile is replaced by `{ deleting: true, expiresAt: Timestamp }`. This content-free guard remains about 48 hours plus TTL processing time. It prevents a request that passed its initial Auth check just before deletion from recreating the profile. It contains no name, email, choice, or classroom pointer. The original profile contents and Auth account are removed by the deletion operation.

Application times use server-generated epoch milliseconds, except TTL fields, which use actual Firestore timestamps. Numeric millisecond values are not valid TTL timestamps.

### Indexes

`firestore.indexes.json` disables single-field indexing on the private `classes` maps (`choices`, `members`, `pending`, `blocked`). `classes.expiresAt` keeps its default single-field index for cleanup. `profiles.expiresAt` and `rateLimits.expiresAt` have TTL enabled and indexing disabled. No composite indexes are needed.

The server follows the caller’s profile pointer to their one current classroom. It does not accept a client-supplied classroom ID as authorization.

## Checks on every callable request

1. The callable framework validates Firebase Auth and, in production, App Check. Missing authentication is rejected.
2. The server fetches the live Auth account. Deleted or disabled accounts and sessions older than `tokensValidAfterTime` are rejected.
3. Both the ID token and live account must show verified email. Deletion is the exception, allowing an unverified user to remove their account.
4. A Firestore transaction applies per-UID rate limits, including failed code guesses.
5. The operation checks the server-owned profile and deletion guard.
6. Membership, host status, deadlines, and selected target validity are checked on the server.
7. Only an explicit per-user projection leaves the server. Application logs contain no request payloads, classroom records, names, or choices.

App Check reduces abuse; it does not prove someone is a classmate. A legitimate browser can still be operated by an attacker. Host admission remains necessary.

## Action policy

| Action | Server requirements and effect |
| --- | --- |
| `setup` | Verified email, valid 2–40-character name, age/participation agreement; name immutable after setup |
| `profile` | Return only caller’s name |
| `create` | No active classroom; results 24 hours–30 days ahead; fixed thereafter |
| `join` | No active classroom; valid private code; lobby not past deadline; not blocked; capacity available; creates a pending request |
| `get` | Return caller’s current classroom projection; removed, expired, or missing room returns null |
| `approve` | Host only, lobby only; target must be pending; max 60 members |
| `remove` | Host only, lobby only; cannot remove self; remove target and block rejoining this round |
| `start` | Host only; lobby; at least 2 members; no pending requests; at least 1 hour before results |
| `choose` | Admitted member; open round; strictly before deadline; another admitted member or null |
| `leave` | Member or pending user; host must close instead; remove outgoing and incoming choices |
| `cancel` | Host only; permanently delete classroom and code index |
| `deleteAccount` | Recent authentication within 5 minutes; remove participation, original profile contents, and Auth account; host’s classroom closes |

Extra request fields such as `uid`, `hostId`, `classroomId`, or modified deadlines grant no authority. The host cannot view or change others’ choices, see voting activity, edit the deadline, or reopen a started round.

## Exactly what the browser receives

| Caller and phase | Response |
| --- | --- |
| Outsider | No class data; a supplied class ID is ignored |
| Pending user | Room ID/name, planned reveal/expiry times, and pending state only |
| Lobby member | Room information, roster names/UIDs, own host flag |
| Lobby host | Same, plus classroom code and pending names/UIDs |
| Open-round member | Room and roster, plus **only their own** `selectedId` |
| Results-phase member | Room and roster, plus mutual match name/UID or `null`; no one-sided choice |
| Removed or expired member | `room: null` |

The server never returns the full `choices` map, inbound crush lists, choice counts, emails, per-user “has voted” flags, total voting participation, or a preview match. Roster size is public to admitted classmates; voting activity is not.

UIDs are identifiers, not credentials. Knowing another person’s UID does not authorize acting on their behalf.

## Matching and time boundaries

For caller `A`, a match with `B` is returned only if:

```text
serverNow >= revealAt
serverNow < expiresAt
room.status == "open"
A and B are still admitted members
A != B
choices[A] == B
choices[B] == A
```

Otherwise, a results-phase member receives `match: null`, shown as **No mutual match this round.** Pending or lobby users do not receive a fabricated non-match result.

Roster changes and choices use Firestore transactions over the same bounded room document. This avoids lost updates, start/join races, and inconsistencies from separately read choice records. The clock is read after obtaining the current room; a transaction retry rechecks current time and data. Concurrent classroom creation also locks the user’s profile, preventing two active rooms for the same account.

The browser formats times in the viewer’s local zone but cannot decide when a choice or result is valid. Changing a device clock has no effect on authorization.

Leaving or deleting an account removes both outgoing and incoming choices. During the results window this can make a previously mutual result disappear; withdrawal takes priority. The service cannot erase a result already seen or screenshotted.

## Codes and abuse limits

Codes use 10 characters from a 32-character alphabet, generated using cryptographic random bytes (about 50 bits of entropy). Code lookup document IDs use SHA-256. Plaintext codes remain on the server-only classroom record so hosts can copy them in the lobby.

- Join attempts: 6 per minute per verified account, including unsuccessful guesses.
- Creation attempts: 3 per day per verified account.
- Other actions: 80 per minute per verified account.
- One active classroom per profile.
- Up to 60 admitted plus pending participants.
- Up to 120 blocked identities per round before a disrupted classroom must be closed.

These measures limit simple guessing and repetition. They do not eliminate distributed abuse, duplicate accounts, or leaked codes. For a larger rollout, consider school-managed identity, enrollment verification, further quota controls, and reviewed moderation operations.

## Cleanup and retention

At `expiresAt = revealAt + 72 hours`, the server stops returning class data immediately, even if physical cleanup is delayed. The scheduled function deletes expired classes and their code indexes together every 15 minutes, in bounded batches. Choices are fields in the class document and are deleted with it.

Do not enable independent TTL on `classes`: that could remove the parent before its code index is cleaned up. The scheduler handles both. There are no sensitive nested subcollections to leave behind.

A profile may temporarily retain an opaque pointer to a removed classroom; its next `get` clears that pointer. It contains no other students’ names or choices. Profiles remain until account deletion.

Rate limits and deletion guards use asynchronous TTL. Infrastructure logs, exports, and backups have separate operator-configured retention. Avoid sensitive payload logging and never promise immediate physical erasure from every backup.

## Verification

```sh
npm test
npm run test:emulator
```

The tests cover denied reads/writes/queries for anonymous users, members, and purported admins; email verification; disabled/revoked accounts; admission; host restrictions; simultaneous choices; mutual-only results; deadline boundaries; expiry before cleanup; code guessing; concurrent room creation; and account deletion.

Also test the deployed endpoint with valid and missing App Check tokens before launch. Emulator tests do not prove production IAM, DNS, email delivery, Scheduler configuration, or App Check registration is correct.

## Operational boundaries

Authorized project administrators can access stored choices through Firebase/Google Cloud. This is not end-to-end encryption. A compromised project owner or leaked service-account key can bypass rules. Minimize IAM access, require administrator MFA, and never put secrets into `VITE_` variables.

Age and school enrollment are self-declared. Hosts should verify students in person, avoid duplicate or ambiguous display names, and reject impersonators. Provide a monitored support contact. Students must be free to opt out. No application can guarantee that users never show someone else their own result or screenshot.

References: [Firestore field-access rules](https://firebase.google.com/docs/firestore/security/rules-fields), [server SDK authorization](https://firebase.google.com/docs/firestore/security/get-started), [callable functions](https://firebase.google.com/docs/functions/callable), [App Check](https://firebase.google.com/docs/app-check), [TTL](https://firebase.google.com/docs/firestore/ttl).
