export const ITEM_ACTIONS = Object.freeze(['reroll', 'upgrade', 'downgrade']);

const validDrawId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const drawIdOf = entry => typeof entry === 'string' ? entry : entry?.drawId;

/** Old sessions start with three charges; imported records keep only known actions. */
export function createItemActionState(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    usedActions: Array.isArray(source.usedActions)
      ? [...new Set(source.usedActions.filter(action => ITEM_ACTIONS.includes(action)))]
      : [],
    modifiedDrawIds: Array.isArray(source.modifiedDrawIds)
      ? [...new Set(source.modifiedDrawIds.filter(validDrawId))]
      : [],
  };
}

/** A charge belongs to its session and a modification belongs to its draw ticket. */
export function canUseItemAction(rawState, entry, action) {
  if (!ITEM_ACTIONS.includes(action)) return false;
  if (entry?.cursed === true || entry?.locked === true) return false;
  const drawId = drawIdOf(entry);
  if (!validDrawId(drawId)) return false;
  const state = createItemActionState(rawState);
  return !state.usedActions.includes(action) && !state.modifiedDrawIds.includes(drawId);
}

export function getItemActionAvailability(rawState, entry) {
  const state = createItemActionState(rawState);
  const drawId = drawIdOf(entry);
  return Object.fromEntries(ITEM_ACTIONS.map(action => {
    const reason = !validDrawId(drawId) ? 'missing-item'
      : entry?.cursed === true || entry?.locked === true ? 'cursed'
      : state.usedActions.includes(action) ? 'used'
        : state.modifiedDrawIds.includes(drawId) ? 'modified' : '';
    return [action, { available: !reason, reason }];
  }));
}

/** Commit only after a valid result exists. Both tickets lock, even for a preview. */
export function spendItemAction(rawState, entry, resultEntry, action) {
  if (!ITEM_ACTIONS.includes(action)) throw new TypeError('Unknown item action.');
  if (!canUseItemAction(rawState, entry, action)) throw new RangeError('This item action is unavailable.');
  const resultDrawId = drawIdOf(resultEntry);
  if (!validDrawId(resultDrawId)) throw new TypeError('An item action requires a valid result ticket.');
  const state = createItemActionState(rawState);
  return {
    usedActions: [...state.usedActions, action],
    modifiedDrawIds: [...new Set([...state.modifiedDrawIds, drawIdOf(entry), resultDrawId])],
  };
}
