import { randomUnitInterval } from './roulette.js';

// The outcome is decided before this visual strip is assembled. Its neighbors
// are only previews, drawn from the same eligible pool as the real selection.
export function createReelPlan(candidates, winner, { random = randomUnitInterval, quick = false, neighbors = 1 } = {}) {
  if (!winner?.id) throw new TypeError('A reel needs its selected entry');
  const pool = [...new Map([...candidates, winner].filter(entry => entry?.id).map(entry => [entry.id, entry])).values()];
  const draw = () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Invalid reel random value');
    return value;
  };
  const visibleNeighbors = neighbors === 2 ? 2 : 1;
  const steps = quick ? 17 : 31;
  const landingIndex = steps + visibleNeighbors;
  const entries = [];
  for (let index = 0; index < landingIndex + visibleNeighbors + 2; index++) {
    if (index === landingIndex) { entries.push(winner); continue; }
    const avoid = index === landingIndex - 1 || index === landingIndex + 1 ? winner.id : entries.at(-1)?.id;
    const choices = pool.length > 1 ? pool.filter(entry => entry.id !== avoid) : pool;
    entries.push(choices[Math.floor(draw() * choices.length)]);
  }
  return {
    entries,
    startIndex: visibleNeighbors,
    neighbors: visibleNeighbors,
    landingIndex,
    overshoot: (draw() < .5 ? -1 : 1) * .22,
    travelDuration: quick ? 1780 : 6100,
    settleDuration: quick ? 550 : 720,
  };
}

export function reelPosition(plan, elapsed) {
  if (elapsed <= 0) return plan.startIndex;
  if (elapsed < plan.travelDuration) {
    const progress = elapsed / plan.travelDuration;
    return plan.startIndex + (plan.landingIndex + plan.overshoot - plan.startIndex) * (1 - (1 - progress) ** 2.6);
  }
  const spring = (elapsed - plan.travelDuration) / plan.settleDuration;
  if (spring >= 1) return plan.landingIndex;
  // Starts with zero velocity, passes the center and returns without a snap.
  const displacement = Math.exp(-5 * spring) * (Math.cos(9 * spring) + 5 / 9 * Math.sin(9 * spring));
  return plan.landingIndex + plan.overshoot * displacement;
}

export function reelDuration(plan) { return plan.travelDuration + plan.settleDuration; }
