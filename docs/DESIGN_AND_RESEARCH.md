# Likewise — research and design decisions

## Product

Mutual discovery without a public confession requires server-side privacy, voluntary participation, and simple results instead of a popularity game.

The flow is: verified account → recognizable name → create or request to join → host confirms roster → host starts → private choice → fixed deadline → 72-hour results window → removal.

A code alone cannot prove school membership, so join requests require host approval. Every student does not have to join. Hosts see the roster but no voting activity or match counts.

No messaging, uploads, feeds, public people search, one-sided alerts, or rankings were added. They would increase exposure and moderation requirements without helping the mutual-only flow.

## Visual direction

The supplied red/charcoal lockup and symbol remain unchanged on a white background. The site combines original paper-envelope artwork, a conversational headline, outlined controls, fine separators, and generous spacing. DM Sans and Manrope fonts are bundled locally; a serif italic accent gives “too?” and “likewise” a personal tone.

Motion includes pointer-reactive artwork, floating labels, scroll entrances, button transitions, and dialogs. Reduced-motion preferences disable it. Classroom, results, and account views provide the working product beyond the landing page.

## Research findings

1. Callable functions carry Auth and App Check tokens, but still need application authorization. [Firebase callables](https://firebase.google.com/docs/functions/callable)
2. Rules cannot hide selected fields in an otherwise readable Firestore document. The implementation denies direct reads and returns per-user server projections. [Field access rules](https://firebase.google.com/docs/firestore/security/rules-fields)
3. Firebase supports verification and password-reset emails. The app uses its hosted action handler and requires verification before classroom access. [Managing users](https://firebase.google.com/docs/auth/web/manage-users)
4. TTL is asynchronous and does not remove subcollections. Access expiration is checked on the server; scheduled cleanup deletes class and code together. [Firestore TTL](https://firebase.google.com/docs/firestore/ttl)
5. GitHub Pages supports custom build/deploy workflows. Relative assets and hash navigation work for project subpaths; server functions remain on Firebase. [Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
6. App Check complements authentication rather than replacing membership verification. [Firebase App Check](https://firebase.google.com/docs/app-check)

## Deliberate limits

- Ages 13–17 by self-declaration; no claim of verified age or school enrollment.
- One active classroom, maximum 60 participants including the host.
- Fixed results time 24 hours–30 days after creation.
- Host starts at least one hour before results and resolves pending requests first.
- Withdrawing removes choices involving that person, including during the results window.
- Classroom access closes at exactly 72 hours after results; physical deletion normally follows within 15 minutes.
- Account profiles remain until account deletion.
- No analytics initialization, ad tracking, external font calls, or browser Firestore persistence.
- Display names stay fixed after setup to discourage impersonation during rounds.

Change these deliberately in server validation and tests, not only in frontend copy.
