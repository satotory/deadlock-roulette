/** Leave the message on screen long enough to read, including in quick mode. */
export function curseTiming({ quick = false, reducedMotion = false } = {}) {
  const phases = reducedMotion
    ? { appear: 160, hold: 1400, disappear: 240 }
    : quick
      ? { appear: 220, hold: 1320, disappear: 260 }
      : { appear: 280, hold: 2100, disappear: 420 };
  return { ...phases, total: phases.appear + phases.hold + phases.disappear };
}
