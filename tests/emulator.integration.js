import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { getAuth as getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword, sendEmailVerification, applyActionCode, sendPasswordResetEmail, confirmPasswordReset, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { createService } from '../functions/service.js';
import { DAY } from '../functions/domain.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

test('Firestore + Auth emulator: privacy and full classroom lifecycle', async t => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run with npm run test:emulator; never against production.');
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const projectId = 'demo-likewise';
  const app = initializeApp({ projectId }); const db = getFirestore(app); const auth = getAuth(app);
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  let now = Date.now(); const service = createService(db, auth, () => now);
  const uid = prefix => `${prefix}-${Math.random().toString(36).slice(2,9)}`;
  const a = uid('alice'), b = uid('bob'), c = uid('charlie'), outsider = uid('outside');
  const token = { email_verified: true, auth_time: Math.ceil(now / 1000) };
  const call = (id, action, data = {}) => service.call(id, token, { action, ...data });
  let r;
  try {
    await env.clearFirestore();
    await t.test('verification and password-reset SDK requests generate usable email actions', async () => {
      const client = initializeClientApp({apiKey:'demo-key',projectId},'auth-flow');
      const clientAuth = getClientAuth(client);
      connectAuthEmulator(clientAuth,'http://127.0.0.1:9099',{disableWarnings:true});
      const email = `${uid('email-flow')}@example.test`;
      try {
        const credential = await createUserWithEmailAndPassword(clientAuth,email,'BeforeReset!2026');
        assert.equal(credential.user.emailVerified,false);
        await sendEmailVerification(credential.user);
        const actions = async () => (await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`)).json()).oobCodes;
        const verification = (await actions()).find(x=>x.email===email && x.requestType==='VERIFY_EMAIL');
        assert.ok(verification, 'Verification email action must be generated');
        await applyActionCode(clientAuth,verification.oobCode);
        await credential.user.reload();
        assert.equal(credential.user.emailVerified,true);
        await signOut(clientAuth);
        await sendPasswordResetEmail(clientAuth,email);
        const reset = (await actions()).find(x=>x.email===email && x.requestType==='PASSWORD_RESET');
        assert.ok(reset, 'Password-reset action must be generated');
        await confirmPasswordReset(clientAuth,reset.oobCode,'AfterReset!2026');
        await assert.rejects(signInWithEmailAndPassword(clientAuth,email,'BeforeReset!2026'));
        assert.equal((await signInWithEmailAndPassword(clientAuth,email,'AfterReset!2026')).user.emailVerified,true);
      } finally { await deleteClientApp(client); }
    });
    for (const id of [a,b,c,outsider]) await auth.createUser({ uid:id, email:`${id}@example.test`, emailVerified:true });
    token.auth_time = Math.ceil(Date.now()/1000);
    await t.test('direct SDK reads, queries and writes are denied for anonymous, member and host', async () => {
      for (const context of [env.unauthenticatedContext(), env.authenticatedContext(a, {email_verified:true}), env.authenticatedContext(b, {email_verified:true, admin:true})]) {
        const client = context.firestore();
        for (const path of ['classes/secret','profiles/self','codes/code','rateLimits/test','anything/else']) {
          await assertFails(getDoc(doc(client,path)));
          await assertFails(setDoc(doc(client,path), { choices:{a:'b'} }));
        }
        await assertFails(getDocs(collection(client,'classes')));
      }
    });
    await t.test('unverified, disabled and revoked accounts are rejected', async () => {
      await assert.rejects(service.call(a, {...token,email_verified:false}, {action:'profile'}), /Verify/);
      await auth.updateUser(outsider, {disabled:true});
      await assert.rejects(call(outsider,'profile'), /unavailable/);
      await auth.updateUser(outsider, {disabled:false});
      await auth.revokeRefreshTokens(a);
      await assert.rejects(service.call(a,{...token,auth_time:1},{action:'profile'}), /sign in again/);
      token.auth_time = Math.ceil(Date.now()/1000);
    });
    await t.test('profiles, creation, private codes and admission', async () => {
      for (const [id,name] of [[a,'Alice'],[b,'Bob'],[c,'Charlie'],[outsider,'Outside']]) await call(id,'setup',{name,consent:true});
      await assert.rejects(call(a,'create',{name:'Class',revealAt:now+1000}), /24 hours/);
      r = (await call(a,'create',{name:'Class 10B',revealAt:now+2*DAY})).room;
      assert.equal(r.code.length,10);
      assert.equal((await call(outsider,'get')).room,null);
      for (const id of [b,c]) {
        const request = (await call(id,'join',{code:r.code})).room;
        assert.equal(request.state,'pending'); assert.equal(request.members,undefined);
        await assert.rejects(call(id,'choose',{target:a}), /not in/);
        await call(a,'approve',{target:id});
      }
      assert.equal((await call(b,'get')).room.code, undefined);
      await assert.rejects(call(b,'start'), /Only the host/);
    });
    await t.test('start locks admission, selections are atomic and private', async () => {
      await call(a,'start');
      await assert.rejects(call(outsider,'join',{code:r.code}), /unavailable/);
      await assert.rejects(call(a,'remove',{target:b}), /locked/);
      await Promise.all([call(a,'choose',{target:b}),call(b,'choose',{target:a}),call(c,'choose',{target:b})]);
      const view = (await call(a,'get')).room;
      assert.equal(view.selectedId,b); assert.equal(view.choices,undefined); assert.equal(view.match,undefined);
      // Supplied class IDs are ignored; membership comes from the server profile.
      assert.equal((await call(outsider,'get',{classroomId:r.id})).room,null);
    });
    await t.test('server deadline returns mutual-only results, rejects changes', async () => {
      now = r.revealAt;
      await assert.rejects(call(a,'choose',{target:c}), /closed/);
      assert.equal((await call(a,'get')).room.match.id,b);
      assert.equal((await call(b,'get')).room.match.id,a);
      assert.equal((await call(c,'get')).room.match,null);
      assert.equal((await call(a,'get')).room.selectedId,undefined);
    });
    await t.test('expiry denies access before the deletion scheduler runs', async () => {
      now = r.expiresAt;
      assert.equal((await call(a,'get')).room,null);
      assert.equal((await db.doc(`classes/${r.id}`).get()).exists,true);
      assert.equal(await service.cleanup(),1);
      assert.equal((await db.doc(`classes/${r.id}`).get()).exists,false);
      assert.equal((await db.collection('codes').get()).size,0);
    });
    await t.test('concurrent creation cannot put a user in two rooms', async () => {
      const outcomes = await Promise.allSettled([call(a,'create',{name:'Next class',revealAt:now+DAY}),call(a,'create',{name:'Other class',revealAt:now+DAY})]);
      assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    });
    await t.test('join guessing is limited, including failed guesses', async () => {
      for (let i=0;i<6;i++) await assert.rejects(call(outsider,'join',{code:'AAAAAAAAAA'}), /unavailable/);
      await assert.rejects(call(outsider,'join',{code:'AAAAAAAAAA'}), /slow down/);
    });
    await t.test('recent reauthentication is required for deletion; host deletion closes class', async () => {
      await assert.rejects(call(a,'deleteAccount'), /Sign in again/);
      const fresh = {...token,auth_time:Math.ceil(now/1000)};
      await service.call(a,fresh,{action:'deleteAccount'});
      assert.equal((await db.doc(`profiles/${a}`).get()).data().deleting,true);
      assert.equal((await db.doc(`profiles/${a}`).get()).data().name,undefined);
      assert.equal((await db.collection('classes').get()).size,0);
      await assert.rejects(call(a,'profile'));
    });
  } finally { await env.cleanup(); await deleteApp(app); }
});
