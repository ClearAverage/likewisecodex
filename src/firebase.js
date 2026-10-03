import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

export const emulator = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';
const app = initializeApp({
  apiKey: 'AIzaSyCnGcVAW0-4SW0XR-cbpK-7H-2gQ2Izmbs',
  authDomain: 'likewisecodex.firebaseapp.com',
  projectId: emulator ? 'demo-likewise' : 'likewisecodex',
  storageBucket: 'likewisecodex.firebasestorage.app',
  messagingSenderId: '642146757928',
  appId: '1:642146757928:web:303b58fa04eaeed750741d',
  measurementId: 'G-DGEDLY416L',
});
export const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1');
export const authReady = setPersistence(auth, browserSessionPersistence);
const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
export const backendConfigured = !!siteKey || emulator;
if (siteKey) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
if (emulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
const callable = httpsCallable(functions, 'likewise');
export async function api(action, data = {}) {
  if (!backendConfigured) throw new Error('Classrooms are not open yet. The site owner needs to finish Firebase App Check setup.');
  return (await callable({ ...data, action })).data;
}
// Analytics is deliberately not initialized. No crush choices enter analytics,
// localStorage, URLs, notification payloads, or client-side Firestore caches.
