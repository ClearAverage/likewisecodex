import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, cleanName, phase, publicRoom, mutateRoom } from '../functions/domain.js';

const room = () => ({ id: 'room1', name: 'Class 10B', hostId: 'alice', status: 'open', revealAt: 10 * DAY, expiresAt: 13 * DAY, code: 'SECRET1234', members: { alice: 'Alice', bob: 'Bob', charlie: 'Charlie' }, pending: {}, choices: { alice: 'bob', bob: 'alice', charlie: 'bob' }, blocked: {} });
test('neither host nor member receives private choices or activity counts', () => {
  for (const uid of ['alice', 'bob', 'charlie']) {
    const view = publicRoom(room(), uid, 9 * DAY);
    assert.equal(view.match, undefined); assert.equal(view.choices, undefined);
    assert.equal(view.selectedId, room().choices[uid]);
    assert.deepEqual(Object.keys(view).sort(), ['id','name','state','revealAt','expiresAt','host','members','selectedId'].sort());
  }
});
test('only mutual matches are returned at the exact reveal boundary', () => {
  assert.deepEqual(publicRoom(room(), 'alice', 10 * DAY).match, { id:'bob', name:'Bob' });
  assert.deepEqual(publicRoom(room(), 'bob', 10 * DAY).match, { id:'alice', name:'Alice' });
  assert.equal(publicRoom(room(), 'charlie', 10 * DAY).match, null);
  assert.equal(publicRoom(room(), 'alice', 10 * DAY).selectedId, undefined);
});
test('expired classroom is inaccessible at the exact 72-hour boundary', () => {
  assert.equal(phase(room(), 13 * DAY), 'expired');
  assert.equal(publicRoom(room(), 'alice', 13 * DAY), null);
});
test('outsiders cannot read or select, and users cannot select themselves', () => {
  assert.throws(() => publicRoom(room(), 'intruder', DAY), /not available/);
  assert.throws(() => mutateRoom(room(), 'intruder', 'choose', {target:'alice'}, DAY), /not in/);
  assert.throws(() => mutateRoom(room(), 'alice', 'choose', {target:'alice'}, DAY), /Choose someone/);
  assert.throws(() => mutateRoom(room(), 'alice', 'choose', {target:'intruder'}, DAY), /Choose someone/);
});
test('deadline cannot be bypassed by a late choice', () => {
  assert.throws(() => mutateRoom(room(), 'alice', 'choose', {target:'charlie'}, 10 * DAY), /closed/);
});
test('roster is immutable after start, even for the host', () => {
  for (const action of ['approve', 'remove', 'start']) assert.throws(() => mutateRoom(room(), 'alice', action, {target:'bob'}, DAY), /locked/);
  assert.throws(() => mutateRoom(room(), 'bob', 'cancel', {}, DAY), /Only the host/);
});
test('leaving removes outgoing and incoming choices', () => {
  const updated = mutateRoom(room(), 'bob', 'leave', {}, DAY);
  assert.deepEqual(updated.choices, {}); assert.equal(updated.members.bob, undefined);
});
test('pending members receive no roster, code, or choices', () => {
  const r = room(); r.status = 'lobby'; r.pending.dan = 'Dan';
  assert.deepEqual(Object.keys(publicRoom(r,'dan',DAY)).sort(), ['id','name','state','revealAt','expiresAt'].sort());
});
test('start requires reviewed requests, minimum roster, and time left', () => {
  const r = room(); r.status = 'lobby'; r.pending.dan = 'Dan';
  assert.throws(() => mutateRoom(r,'alice','start',{},DAY), /Review/);
  r.pending = {}; r.members = {alice:'Alice'};
  assert.throws(() => mutateRoom(r,'alice','start',{},DAY), /At least two/);
  r.members.bob = 'Bob';
  assert.throws(() => mutateRoom(r,'alice','start',{},10 * DAY - 100), /one hour/);
});
test('clearing choices produces no mutual match', () => {
  const r = mutateRoom(room(), 'alice', 'choose', {target:null}, DAY);
  assert.equal(publicRoom(r, 'bob', 10 * DAY).match, null);
});
test('display names reject markup, control characters and long input', () => {
  assert.equal(cleanName('  Álex  M.  '), 'Álex M.');
  for (const name of ['<script>', 'A', 'a'.repeat(41), 'test\u202ename']) assert.throws(() => cleanName(name));
});
