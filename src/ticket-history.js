import { normalizeHistory } from './history.js';
import { ITEM_COMBOS } from './item-combos.js';

/** Rebuild ticket identity from the trusted catalog, rather than imported aliases. */
export function canonicalTicketHistory(raw, knownIds, { inventory = false } = {}) {
  const combos = new Map(ITEM_COMBOS.filter(combo => !knownIds || combo.itemIds.every(id => knownIds.has(id))).map(combo => [combo.id, combo]));
  const records = (Array.isArray(raw) ? raw : []).map(entry => {
    if (!entry || typeof entry !== 'object') return entry;
    const combo = combos.get(entry.itemId);
    return !inventory && combo ? { ...entry, itemIds: [...combo.itemIds] } : entry;
  });
  return normalizeHistory(records, knownIds).map(entry => {
    const aliases = [entry.ticketId, entry.comboOrigin].filter(Boolean);
    const validCombo = aliases.map(id => combos.get(id)).find(combo => combo?.itemIds.includes(entry.itemId));
    const result = { ...entry };
    if (inventory && validCombo) { result.ticketId = validCombo.id; result.comboOrigin = validCombo.id; }
    else {
      delete result.comboOrigin;
      if (aliases.length) result.ticketId = entry.itemId;
    }
    return result;
  });
}
