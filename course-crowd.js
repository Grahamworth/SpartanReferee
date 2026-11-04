// The other people on the course: contestants running it with you, officials
// at the obstacles and marshal points watching the runners go by, and crowds
// cheering in town and at the start and finish.
/* global THREE */
import { makePerson, makePool, animatePerson, randomLook, showProp } from './course-people.js?v=2';
import { pointAt, rng, TRAIL_W } from './course-world.js?v=2';
import { act } from './course-obstacles.js?v=2';

const POSE_AT = { climb: 'climb', rig: 'hang', carry: 'carry', crawl: 'crawl', balance: 'balance', hoist: 'climb', aim: 'throw', bell: 'jump', hurdle: 'jump', memoryBoard: null, memoryTest: null };
const FAILABLE = new Set(['climb', 'rig', 'balance', 'hoist', 'aim']);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function makeCrowd(scene, W, T, { contestants = 12, officials = 6, spectators = 20, shadows = true, slopeFactor }) {
  const r = rng(Date.now() & 0xffffff);
  const cs = W.cs, total = cs[cs.length - 1].d;

  // ---- contestants: a mass start around you, then everyone at their own pace; anyone far ahead or behind
  // drops back in near you so there's always company on the course
  const bots = [];
  for (let i = 0; i < contestants; i++) {
    const P = makePerson(randomLook(r), { shadows });
    scene.add(P.root);
    bots.push({ P, d: 1 + r() * 22, lat: (r() - 0.5) * (TRAIL_W - 1.2), pace: 3.6 + r() * 1.8, state: 'run', timer: 0, next: 0, acc: 0, v: 0, stagger: 0, sway: 0 });
  }
  const nextObAfter = (d) => { const k = W.obs.findIndex((o) => o.at > d + 2); return k < 0 ? W.obs.length : k; };
  function respawn(b, playerD) {
    const ahead = r() < 0.55, gap = 50 + r() * 150;
    b.d = Math.max(0, Math.min(total - 30, playerD + (ahead ? gap : -gap)));
    b.next = nextObAfter(b.d); b.state = 'run'; b.lat = (r() - 0.5) * (TRAIL_W - 1.2);
  }
  function updateBots(dt, playerD, cam, finished) {
    for (const b of bots) {
      if (b.d - playerD > 280 || playerD - b.d > 240) respawn(b, playerD);
      let pose = null, t = 0;
      if (b.state === 'run') {
        const o = W.obs[b.next];
        const p0 = pointAt(cs, Math.max(0, b.d)), p1 = pointAt(cs, Math.max(0, b.d) + 2);
        b.v += ((b.d >= total - 2 ? 0 : b.pace * slopeFactor((p1.y - p0.y) / 2)) - b.v) * Math.min(1, dt * 2);
        b.d += b.v * dt;
        if (o && b.d >= o.at + o.spec.from) {
          b.state = 'ob'; b.kind = o.kind; b.v = 0;
          const L = o.spec.lanes, mid = Math.floor((L.length - 1) / 2), others = L.filter((_, i) => i !== mid); // (the middle lane is yours)
          b.lane = others.length ? others[bots.indexOf(b) % others.length] : L[0];
          b.tTotal = b.timer = o.spec.dur * (1.4 + r() * 1.6) + (o.kind === 'carry' ? 6 : 0);
        }
      } else if (b.state === 'ob') {
        b.timer -= dt;
        const o = W.obs[b.next], a = act(o.spec, clamp01(1 - b.timer / b.tTotal), b.lane);
        b.a = a; pose = a.pose;
        if (b.timer <= 0) {
          b.a = null;
          if (FAILABLE.has(b.kind) && r() < 0.18 && !finished) { b.state = 'burpee'; b.timer = 9 + r() * 5; b.bt = 0; }
          else { b.state = 'run'; b.d = o.at + o.spec.to; b.next++; }
        }
      } else if (b.state === 'burpee') {
        pose = 'burpee'; b.bt = (b.bt + dt / 0.95) % 1; t = b.bt; b.timer -= dt;
        if (b.timer <= 0) { const o = W.obs[b.next]; b.state = 'run'; b.d = o.at + o.spec.to; b.next++; }
      }
      // a shove: staggering, then back to their line
      if (b.stagger > 0) { b.stagger -= dt; if (b.state === 'run') { b.v *= 1 - 3 * dt; pose = b.down ? 'crawl' : 'balance'; } }
      else b.down = false;
      // place: on the trail at its own lateral spot (doing burpees off to the side), or on the obstacle
      let p, side, up = 0, face = 0;
      if (b.state === 'ob' && b.a) { const o = W.obs[b.next]; p = pointAt(cs, Math.max(0, o.at + b.a.along)); side = b.a.lat; up = b.a.up; face = b.a.face; }
      else { p = pointAt(cs, Math.max(0, b.d)); side = b.state === 'burpee' ? Math.sign(b.lat || 1) * (TRAIL_W / 2 + 1.2) : b.lat; }
      const x = p.x + Math.cos(p.h) * side, z = p.z - Math.sin(p.h) * side;
      b.P.root.position.set(x, T.hAt(x, z) + up, z); b.P.root.rotation.y = p.h + face + (b.stagger > 0 ? Math.sin(b.stagger * 9) * 0.25 : 0);
      b.x = x; b.z = z; b.h = p.h;
      const dist = cam.distanceTo(b.P.root.position);
      b.P.root.visible = dist < 260;
      if (!b.P.root.visible) continue;
      b.acc += dt;
      showProp(b.P, pose === 'carry' ? W.obs[b.next] && W.obs[b.next].name : null);
      if (dist < 60 || b.acc > 0.1) { animatePerson(b.P, b.acc, b.v, pose, t); b.acc = 0; } // far away, animate less often
    }
  }

  // ---- officials and spectators: pools moved to the nearest spots
  const offPool = makePool(scene, officials, () => randomLook(r, 'official'), { shadows });
  const specPool = makePool(scene, spectators, () => randomLook(r, 'spectator'), { shadows });
  for (const s of W.officials) s.look = randomLook(r, 'official');
  for (const s of W.spectators) { s.look = randomLook(r, 'spectator'); s.phase = r() * 10; }
  let assignAt = 0, cheering = 0;
  function updatePeople(dt, now, px, pz) {
    if (now > assignAt) { assignAt = now + 600; offPool.assign(W.officials, px, pz, 140); specPool.assign(W.spectators, px, pz, 110); }
    cheering = 0;
    for (const [pool, kind] of [[offPool, 'official'], [specPool, 'spectator']]) for (const p of pool.people) {
      if (!p.slot) continue;
      const d = Math.hypot(p.slot.x - px, p.slot.z - pz), near = d < (kind === 'official' ? 30 : 45);
      // watch the runner go by: turn towards them while they're close, back to the trail after
      const want = near ? Math.atan2(px - p.slot.x, pz - p.slot.z) : p.slot.face;
      p.root.rotation.y += angDiff(p.root.rotation.y, want) * Math.min(1, dt * 3);
      const cheer = kind === 'spectator' && (near || Math.sin(now / 1000 + p.slot.phase) > 0.6);
      if (cheer && near) cheering++;
      p.acc = (p.acc || 0) + dt;
      if (d < 50 || p.acc > 0.12) { animatePerson(p, p.acc, 0, cheer ? 'cheer' : 'watch'); p.acc = 0; }
    }
  }

  return {
    bots,
    update(dt, now, player, playerD, cam, finished) {
      updateBots(dt, playerD, cam, finished);
      updatePeople(dt, now, player.x, player.z);
      return cheering;
    },
    // You and the other runners push each other apart: each of you moves half the overlap (they move sideways on
    // the trail and lose a little ground); run into someone hard and they stagger, or go down, and you lose speed.
    // (vx, vz: your velocity.) Returns where you end up, or null if you touched no one.
    bump(x, z, vx, vz, dt) {
      let out = null;
      for (const b of bots) {
        if (b.x === undefined || b.state !== 'run' || !b.P.root.visible) continue;
        const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz), R = 0.62;
        if (d >= R || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, over = R - d;
        // how hard: your speed into them, less theirs away from you
        const bvx = Math.sin(b.h) * b.v, bvz = Math.cos(b.h) * b.v, closing = -((vx - bvx) * nx + (vz - bvz) * nz);
        x += nx * over * 0.5; z += nz * over * 0.5;
        // they're moved the other way: across the trail (kept between the tapes) and back along it
        const c = Math.cos(b.h), s = Math.sin(b.h), across = -(nx * c - nz * s) * over * 0.5, along = -(nx * s + nz * c) * over * 0.5;
        b.lat = Math.max(-TRAIL_W / 2 + 0.35, Math.min(TRAIL_W / 2 - 0.35, b.lat + across * 1.6)); b.d += along;
        const hard = closing > 2.2;
        if (hard && b.stagger <= 0) { b.stagger = closing > 4.2 ? 1.6 : 0.7; b.down = closing > 4.2; b.v *= 0.3; b.lat = Math.max(-TRAIL_W / 2 + 0.35, Math.min(TRAIL_W / 2 - 0.35, b.lat + Math.sign(across || 1) * 0.5)); }
        out = { x, z, slow: hard ? 0.55 : 1 - Math.min(0.5, over * 2), hard, down: b.down };
      }
      // and they don't run through each other either
      for (let i = 0; i < bots.length; i++) for (let j = i + 1; j < bots.length; j++) {
        const a = bots[i], c = bots[j];
        if (a.state !== 'run' || c.state !== 'run' || Math.abs(a.d - c.d) > 0.6) continue;
        const gap = Math.abs(a.lat - c.lat); if (gap > 0.55) continue;
        const push = (0.55 - gap) * 0.5 * Math.min(1, dt * 8), sg = a.lat < c.lat ? -1 : 1;
        a.lat = Math.max(-TRAIL_W / 2 + 0.35, Math.min(TRAIL_W / 2 - 0.35, a.lat + sg * push)); c.lat = Math.max(-TRAIL_W / 2 + 0.35, Math.min(TRAIL_W / 2 - 0.35, c.lat - sg * push));
        if (a.d < c.d) a.v = Math.min(a.v, c.v); else c.v = Math.min(c.v, a.v);
      }
      return out;
    },
    pushOut(x, z) { const o = this.bump(x, z, 0, 0, 0); return o ? [o.x, o.z] : [x, z]; },
  };
}
