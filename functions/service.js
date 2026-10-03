import { randomBytes, createHash } from 'node:crypto';
import { DAY, DomainError, demand, cleanName, owns, phase, publicRoom, mutateRoom } from './domain.js';

const codeHash = code => createHash('sha256').update(code).digest('hex');
const active = (room, now) => room && phase(room, now) !== 'expired';
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => [...randomBytes(10)].map(n => codeAlphabet[n % 32]).join('');
const actions = new Set(['profile', 'setup', 'create', 'join', 'get', 'approve', 'remove', 'start', 'cancel', 'choose', 'leave', 'deleteAccount']);

export function createService(db, auth, clock = Date.now) {
  async function rateLimit(uid, action) {
    const bucket = action === 'join' ? 'join' : action === 'create' ? 'create' : 'general';
    const span = bucket === 'create' ? DAY : 60_000;
    const limit = bucket === 'create' ? 3 : bucket === 'join' ? 6 : 80;
    const ref = db.doc(`rateLimits/${uid}_${bucket}`);
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref); const now = clock(); const old = snap.data();
      const current = old && old.until > now ? old : { count: 0, until: now + span };
      demand(current.count < limit, 'Please slow down and try again later.', 'resource-exhausted');
      tx.set(ref, { count: current.count + 1, until: current.until, expiresAt: new Date(now + 2 * DAY) });
    });
  }

  async function deleteAccount(uid, token) {
    demand(clock() / 1000 - token.auth_time < 300, 'Sign in again before deleting your account.', 'unauthenticated');
    const ref = db.doc(`profiles/${uid}`);
    await db.runTransaction(async tx => {
      const p = (await tx.get(ref)).data();
      const roomRef = p?.classroomId ? db.doc(`classes/${p.classroomId}`) : null;
      const room = roomRef ? (await tx.get(roomRef)).data() : null;
      if (room) {
        if (room.hostId === uid) { tx.delete(roomRef); tx.delete(db.doc(`codes/${codeHash(room.code)}`)); }
        else { mutateRoomForDeletion(room, uid); tx.set(roomRef, room); }
      }
      // A tombstone prevents other in-flight requests from recreating this account's data.
      tx.set(ref, { deleting: true, expiresAt: new Date(clock() + 2 * DAY) });
    });
    try { await auth.deleteUser(uid); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    // Keep the content-free deletion guard for 48h (TTL) so a request that
    // passed getUser before deletion cannot recreate a profile afterwards.
    // Rate-limit records contain no names or choices and expire via TTL.
    return { deleted: true };
  }

  function mutateRoomForDeletion(room, uid) {
    delete room.members[uid]; delete room.pending[uid]; delete room.choices[uid]; delete room.blocked[uid];
    for (const [from, target] of Object.entries(room.choices)) if (target === uid) delete room.choices[from];
  }

  async function call(uid, token, input) {
    demand(input && typeof input === 'object' && actions.has(input.action), 'Unknown action.', 'invalid-argument');
    // Check the live Auth record as well as claims: deleted/disabled accounts and
    // revoked sessions must not keep using a still-unexpired ID token.
    const account = await auth.getUser(uid);
    demand(!account.disabled, 'This account is unavailable.', 'permission-denied');
    demand(!account.tokensValidAfterTime || token.auth_time * 1000 >= Date.parse(account.tokensValidAfterTime), 'Please sign in again.', 'unauthenticated');
    demand(input.action === 'deleteAccount' || (token.email_verified && account.emailVerified), 'Verify your email first.', 'permission-denied');
    await rateLimit(uid, input.action);
    if (input.action === 'deleteAccount') return deleteAccount(uid, token);
    const profileRef = db.doc(`profiles/${uid}`);
    return db.runTransaction(async tx => {
      const profile = (await tx.get(profileRef)).data();
      demand(!profile?.deleting, 'Your account is being deleted.', 'permission-denied');
      if (input.action === 'setup') {
        demand(input.consent === true, 'Confirm the age and participation agreement.', 'invalid-argument');
        if (profile) return { profile: { name: profile.name } };
        const name = cleanName(input.name);
        tx.create(profileRef, { name, consentVersion: '2026-10-v1', createdAt: clock(), classroomId: null });
        return { profile: { name } };
      }
      if (input.action === 'profile') return { profile: profile ? { name: profile.name } : null };
      demand(profile, 'Complete your profile first.');
      const previousRef = profile.classroomId ? db.doc(`classes/${profile.classroomId}`) : null;
      const previous = previousRef ? (await tx.get(previousRef)).data() : null;
      const now = clock();
      const hasRoom = active(previous, now) && (owns(previous.members, uid) || owns(previous.pending, uid));
      if (input.action === 'create') {
        demand(!hasRoom, 'Leave your current classroom before creating another.');
        const name = cleanName(input.name);
        const revealAt = Number(input.revealAt);
        demand(Number.isFinite(revealAt) && revealAt >= now + DAY && revealAt <= now + 30 * DAY, 'Choose a results time between 24 hours and 30 days from now.', 'invalid-argument');
        const code = makeCode(); const codeRef = db.doc(`codes/${codeHash(code)}`);
        demand(!(await tx.get(codeRef)).exists, 'Please try creating the classroom again.', 'aborted');
        const ref = db.collection('classes').doc();
        const room = { id: ref.id, name, hostId: uid, status: 'lobby', revealAt, expiresAt: revealAt + 3 * DAY, createdAt: now, code, members: { [uid]: profile.name }, pending: {}, blocked: {}, choices: {} };
        tx.create(ref, room); tx.create(codeRef, { classroomId: ref.id, expiresAt: room.expiresAt });
        tx.update(profileRef, { classroomId: ref.id });
        return { room: publicRoom(room, uid, now) };
      }
      if (input.action === 'join') {
        demand(!hasRoom, 'Leave your current classroom before joining another.');
        const code = typeof input.code === 'string' ? input.code.toUpperCase().replace(/[\s-]/g, '') : '';
        demand(/^[A-HJ-NP-Z2-9]{10}$/.test(code), 'Check the 10-character classroom code.', 'invalid-argument');
        const entry = (await tx.get(db.doc(`codes/${codeHash(code)}`))).data();
        const ref = entry ? db.doc(`classes/${entry.classroomId}`) : null;
        const room = ref ? (await tx.get(ref)).data() : null;
        demand(room && phase(room, clock()) === 'lobby' && clock() < room.revealAt && !owns(room.blocked, uid), 'This code is unavailable or the classroom has already started.', 'not-found');
        demand(Object.keys(room.members).length + Object.keys(room.pending).length < 60, 'This classroom is full.');
        room.pending[uid] = profile.name;
        tx.set(ref, room); tx.update(profileRef, { classroomId: room.id });
        return { room: publicRoom(room, uid, now) };
      }
      if (input.action === 'get') {
        if (!hasRoom) { if (profile.classroomId) tx.update(profileRef, { classroomId: null }); return { room: null }; }
        return { room: publicRoom(previous, uid, now) };
      }
      demand(hasRoom, 'This classroom is no longer available.', 'not-found');
      // The class ID is taken from the server-owned profile, never the request.
      const room = mutateRoom(previous, uid, input.action, input, now);
      if (room === null) {
        tx.delete(previousRef); tx.delete(db.doc(`codes/${codeHash(previous.code)}`));
        tx.update(profileRef, { classroomId: null });
        return { room: null };
      }
      tx.set(previousRef, room);
      if (input.action === 'leave') { tx.update(profileRef, { classroomId: null }); return { room: null }; }
      return { room: publicRoom(room, uid, now) };
    });
  }

  async function cleanup() {
    // Bounded batches avoid one large transaction. No nested collections hold choices.
    let deleted = 0;
    for (let batchNo = 0; batchNo < 20; batchNo++) {
      const expired = await db.collection('classes').where('expiresAt', '<=', clock()).limit(100).get();
      if (expired.empty) break;
      const batch = db.batch();
      for (const doc of expired.docs) { batch.delete(doc.ref); batch.delete(db.doc(`codes/${codeHash(doc.data().code)}`)); }
      await batch.commit(); deleted += expired.size;
    }
    return deleted;
  }
  return { call, cleanup };
}
