export const DAY = 86_400_000;
export class DomainError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function demand(ok, message, code = 'failed-precondition') {
  if (!ok) throw new DomainError(code, message);
}
export function cleanName(value, max = 40) {
  demand(typeof value === 'string', 'Enter a name.', 'invalid-argument');
  const name = value.trim().replace(/\s+/g, ' ');
  demand(name.length >= 2 && name.length <= max && /^[\p{L}\p{M}\p{N} .’'()_-]+$/u.test(name), 'Use 2–40 letters, numbers, spaces, or basic punctuation.', 'invalid-argument');
  return name;
}
export const owns = (map, uid) => Object.hasOwn(map || {}, uid);
export function phase(room, now) {
  if (now >= room.expiresAt) return 'expired';
  if (room.status === 'open' && now >= room.revealAt) return 'results';
  return room.status;
}
export function publicRoom(room, uid, now) {
  const state = phase(room, now);
  if (state === 'expired') return null;
  if (owns(room.pending, uid)) return { id: room.id, name: room.name, state: 'pending', revealAt: room.revealAt, expiresAt: room.expiresAt };
  demand(owns(room.members, uid), 'This classroom is not available.', 'permission-denied');
  const target = room.choices[uid];
  const mutual = state === 'results' && target && target !== uid && owns(room.members, target) && room.choices[target] === uid;
  return {
    id: room.id, name: room.name, state, revealAt: room.revealAt, expiresAt: room.expiresAt,
    host: room.hostId === uid,
    members: Object.entries(room.members).map(([id, name]) => ({ id, name })),
    ...(room.hostId === uid && state === 'lobby' ? { code: room.code, pending: Object.entries(room.pending).map(([id, name]) => ({ id, name })) } : {}),
    ...(state === 'open' ? { selectedId: target || null } : {}),
    ...(state === 'results' ? { match: mutual ? { id: target, name: room.members[target] } : null } : {}),
  };
}
export function removeMember(room, uid) {
  delete room.members[uid]; delete room.pending[uid]; delete room.choices[uid];
  for (const [from, target] of Object.entries(room.choices)) if (target === uid) delete room.choices[from];
  return room;
}
export function mutateRoom(room, uid, action, data, now) {
  const state = phase(room, now);
  demand(state !== 'expired', 'This classroom has expired.');
  if (action === 'leave') {
    demand(owns(room.members, uid) || owns(room.pending, uid), 'You are not in this classroom.', 'permission-denied');
    demand(room.hostId !== uid, 'As host, close the classroom instead.');
    return removeMember(room, uid);
  }
  demand(owns(room.members, uid), 'You are not in this classroom.', 'permission-denied');
  if (['approve', 'remove', 'start', 'cancel'].includes(action)) {
    demand(room.hostId === uid, 'Only the host can do that.', 'permission-denied');
    if (action === 'cancel') return null;
    demand(state === 'lobby' && now < room.revealAt, 'The roster is locked.');
    if (action === 'start') {
      demand(Object.keys(room.members).length >= 2, 'At least two classmates must join.');
      demand(Object.keys(room.pending).length === 0, 'Review every join request first.');
      demand(room.revealAt - now >= 3_600_000, 'Start at least one hour before results.');
      room.status = 'open';
    } else {
      const target = data.target;
      demand(typeof target === 'string' && target !== uid, 'Choose a classmate.', 'invalid-argument');
      if (action === 'approve') {
        demand(owns(room.pending, target), 'That request is no longer available.');
        demand(Object.keys(room.members).length < 60, 'This classroom is full.');
        room.members[target] = room.pending[target]; delete room.pending[target];
      } else {
        demand(owns(room.pending, target) || owns(room.members, target), 'That classmate is not in the roster.');
        demand(Object.keys(room.blocked).length < 120, 'Close this classroom and create a new one if it is being disrupted.');
        room.blocked[target] = true; removeMember(room, target);
      }
    }
  } else if (action === 'choose') {
    demand(state === 'open' && now < room.revealAt, 'Choices are closed.');
    const target = data.target;
    demand(target === null || (typeof target === 'string' && target !== uid && owns(room.members, target)), 'Choose someone in your classroom.', 'invalid-argument');
    if (target === null) delete room.choices[uid]; else room.choices[uid] = target;
  } else throw new DomainError('invalid-argument', 'Unknown action.');
  return room;
}
