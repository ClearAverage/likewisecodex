// Synthetic local-only fixtures for manual UI testing. Never targets production.
import { createRequire } from 'node:module';
import { createService } from '../functions/service.js';
import { DAY } from '../functions/domain.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Local emulators must be explicitly configured.');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
initializeApp({ projectId:'demo-likewise' });
const db = getFirestore(), auth = getAuth(), service = createService(db, auth);
const names = ['Jamie R.', 'Alex M.', 'Sam K.', 'Riley T.', 'Jordan L.', 'Taylor B.', 'Casey W.', 'Morgan S.'];
const token = {email_verified:true,auth_time:Math.ceil(Date.now()/1000)};
for (let i=0;i<names.length;i++) {
  try { await auth.createUser({uid:`preview-${i}`,email:`preview${i}@example.test`,password:'PreviewOnly!2026',emailVerified:true}); }
  catch(e) {if(e.code!=='auth/uid-already-exists') throw e;}
  token.auth_time = Math.ceil(Date.now()/1000);
  await service.call(`preview-${i}`,token,{action:'setup',name:names[i],consent:true});
}
let { room } = await service.call('preview-0',token,{action:'get'});
if(!room) {
  ({room} = await service.call('preview-0',token,{action:'create',name:'Room 204 - Class 10B',revealAt:Date.now()+3*DAY}));
  for(let i=1;i<names.length;i++) {
    await service.call(`preview-${i}`,token,{action:'join',code:room.code});
    await service.call('preview-0',token,{action:'approve',target:`preview-${i}`});
  }
}
console.log('Local demo ready: preview0@example.test / PreviewOnly!2026');
console.log('Room:',room.id);
if (process.argv.includes('--reveal')) {
  if (room.state === 'lobby') await service.call('preview-0',token,{action:'start'});
  if (room.state !== 'results') {
    await service.call('preview-0',token,{action:'choose',target:'preview-1'});
    await service.call('preview-1',token,{action:'choose',target:'preview-0'});
    await db.doc(`classes/${room.id}`).update({revealAt:Date.now()-1000,expiresAt:Date.now()+3*DAY});
  }
  console.log('Local-only results fixture is ready.');
}
