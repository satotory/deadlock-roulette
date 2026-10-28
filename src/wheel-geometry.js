export const TAU = Math.PI * 2;
const wrap = angle => (angle % TAU + TAU) % TAU;

/** Count actual spoke crossings, with no queued or delayed clicks to catch up. */
export function countBoundaryCrossings(previousRotation, currentRotation, entries) {
  if (!Number.isFinite(previousRotation) || !Number.isFinite(currentRotation) || currentRotation <= previousRotation) return 0;
  return entries.reduce((count, entry) => count + Math.max(0,
    Math.floor((currentRotation + entry.start) / TAU) - Math.floor((previousRotation + entry.start) / TAU)), 0);
}

/** Canvas coordinates relative to its centre; the hub and outside are not slots. */
export function slotAtPoint(entries, rotation, x, y, innerRadius, outerRadius) {
  const radius = Math.hypot(x, y);
  if (radius < innerRadius || radius > outerRadius) return -1;
  const angle = wrap(Math.atan2(y, x) - rotation + Math.PI / 2);
  return entries.findIndex(entry => angle >= entry.start && angle < entry.end);
}
