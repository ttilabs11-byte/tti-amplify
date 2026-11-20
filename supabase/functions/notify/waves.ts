// Splits people into alert waves so a new post's comments don't all land at once (LinkedIn reads a burst as a pod).
// People, not devices: one person's phones buzz together. Wave 0 goes now; wave k is due k * gapMs later, a minute
// early so the 10-minute cron run at the boundary picks it up.
export const WAVES = 4;
export const WAVE_MIN = 4;
export const WAVE_GAP_MS = 10 * 60 * 1000;

export function planWaves(userIds: string[], now: number, random: () => number = Math.random) {
  const people = [...new Set(userIds)];
  for (let i = people.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [people[i], people[j]] = [people[j], people[i]];
  }
  const waves = Math.min(WAVES, Math.ceil(people.length / WAVE_MIN));
  const first: string[] = [];
  const later: { user_id: string; send_at: string }[] = [];
  people.forEach((p, i) => {
    const w = waves > 1 ? i % waves : 0;
    if (w === 0) first.push(p);
    else later.push({ user_id: p, send_at: new Date(now - 60_000 + w * WAVE_GAP_MS).toISOString() });
  });
  return { first, later };
}
