import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { createService } from './service.js';
import { DomainError } from './domain.js';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
const service = createService(getFirestore(), getAuth());
// The CLI sets FUNCTIONS_EMULATOR only in local emulation. Deployed functions
// always enforce App Check; no request argument or browser flag disables it.
export const likewise = onCall({ enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', timeoutSeconds: 30, memory: '256MiB' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  try { return await service.call(request.auth.uid, request.auth.token, request.data); }
  catch (e) {
    if (e instanceof DomainError) throw new HttpsError(e.code, e.message);
    if (e.code === 'auth/user-not-found') throw new HttpsError('unauthenticated', 'Please sign in again.');
    // Never log request payloads, class documents, identities, or crush choices.
    console.error('Likewise operation failed', { code: String(e.code || 'internal') });
    throw new HttpsError('internal', 'Something went wrong. Please try again.');
  }
});
export const removeExpiredClasses = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Etc/UTC', timeoutSeconds: 300, retryCount: 3 }, () => service.cleanup());
