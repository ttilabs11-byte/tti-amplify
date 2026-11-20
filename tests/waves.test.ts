// Wave split for "new post" alerts. Run: node --experimental-strip-types tests/waves.test.ts
import { planWaves, WAVE_GAP_MS } from "../supabase/functions/notify/waves.ts";
import assert from "node:assert/strict";
const now = Date.parse("2026-11-20T07:03:00Z");
const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);
// tiny team: everyone now
for (const n of [0, 1, 4]) { const r = planWaves(ids(n), now); assert.equal(r.first.length, n); assert.equal(r.later.length, 0); }
// 8 people: 2 waves of 4
let r = planWaves(ids(8), now); assert.equal(r.first.length, 4); assert.equal(r.later.length, 4);
assert.ok(r.later.every((l) => Date.parse(l.send_at) === now - 60_000 + WAVE_GAP_MS));
// 40 people: 4 waves of 10, due at +9, +19, +29 min
r = planWaves(ids(40), now); assert.equal(r.first.length, 10);
const byTime = new Map<number, number>(); r.later.forEach((l) => byTime.set(Date.parse(l.send_at), (byTime.get(Date.parse(l.send_at)) ?? 0) + 1));
assert.deepEqual([...byTime.entries()].sort(), [[now + 9 * 60e3, 10], [now + 19 * 60e3, 10], [now + 29 * 60e3, 10]]);
// everyone exactly once; duplicate ids (two phones) collapse to one person
r = planWaves([...ids(13), "u1", "u2"], now);
const all = [...r.first, ...r.later.map((l) => l.user_id)]; assert.equal(all.length, 13); assert.equal(new Set(all).size, 13);
// shuffled: wave 0 differs between two random seeds
const a = planWaves(ids(40), now, () => 0.1).first.join(), b = planWaves(ids(40), now, () => 0.9).first.join(); assert.notEqual(a, b);
// known-bad guard: a broken split (everyone in wave 0) must fail the 40-person check
assert.throws(() => assert.equal(planWaves(ids(40), now).first.length, 40));
console.log("waves: all checks pass");
