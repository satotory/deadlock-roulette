// Current game recipes and numeric charge properties; see docs/game-rules-sources.md.
export { ITEM_COMBOS } from './item-combos.js';
export const ITEM_COMPONENTS = Object.freeze({
  "7409189": [
    "968099481"
  ],
  "112198670": [
    "1672893796"
  ],
  "334300056": [
    "4139877411"
  ],
  "493591231": [
    "1102081447"
  ],
  "673001892": [
    "3077079169"
  ],
  "690458959": [
    "3077079169"
  ],
  "709540378": [
    "1009965641"
  ],
  "710436191": [
    "811521119"
  ],
  "787198704": [
    "3776945997"
  ],
  "800008313": [
    "26002154"
  ],
  "805079544": [
    "1672893796"
  ],
  "857669956": [
    "1672893796"
  ],
  "865846625": [
    "499683006",
    "876563814"
  ],
  "915014646": [
    "3261353684"
  ],
  "951866250": [
    "1644605047"
  ],
  "1055679805": [
    "499683006"
  ],
  "1150006784": [
    "4139877411"
  ],
  "1152158042": [
    "1813726886"
  ],
  "1193964439": [
    "754480263"
  ],
  "1250307611": [
    "2447176615"
  ],
  "1252627263": [
    "1437614329"
  ],
  "1292979587": [
    "968099481"
  ],
  "1409190604": [
    "499683006"
  ],
  "1427630806": [
    "2566692615"
  ],
  "1644605047": [
    "1672893796"
  ],
  "1662311306": [
    "857669956"
  ],
  "1797283378": [
    "876563814"
  ],
  "1798666702": [
    "3399065363"
  ],
  "1804594021": [
    "1710079648"
  ],
  "1955841979": [
    "1047818222"
  ],
  "2061878743": [
    "2922054143"
  ],
  "2064029594": [
    "3077079169"
  ],
  "2095565695": [
    "1342610602"
  ],
  "2121044373": [
    "1998374645"
  ],
  "2142980412": [
    "1219329868"
  ],
  "2152872419": [
    "3331811235",
    "3077079169"
  ],
  "2226497419": [
    "876563814"
  ],
  "2356412290": [
    "1548066885"
  ],
  "2407781327": [
    "3633614685"
  ],
  "2447176615": [
    "3399065363"
  ],
  "2463960640": [
    "1548066885"
  ],
  "2519598785": [
    "7409189"
  ],
  "2566692615": [
    "2829638276"
  ],
  "2717651715": [
    "2951612397"
  ],
  "2739107182": [
    "668299740"
  ],
  "2947183272": [
    "1439347412"
  ],
  "2956256701": [
    "1710079648"
  ],
  "3005970438": [
    "2081037738"
  ],
  "3074274290": [
    "3399065363"
  ],
  "3190916303": [
    "465043967"
  ],
  "3261353684": [
    "380806748"
  ],
  "3294954488": [
    "754480263"
  ],
  "3357231760": [
    "1047818222"
  ],
  "3585132399": [
    "3633614685"
  ],
  "3791587546": [
    "393974127"
  ],
  "3812615317": [
    "1976391348"
  ],
  "3884003354": [
    "1770441818"
  ],
  "3919289022": [
    "84321454"
  ],
  "3977876567": [
    "4139877411"
  ],
  "4053935515": [
    "2010028405"
  ],
  "4075861416": [
    "1144549437"
  ],
  "4104549924": [
    "668299740"
  ]
});
for (const parents of Object.values(ITEM_COMPONENTS)) Object.freeze(parents);
export const ITEM_UPGRADE_PARENTS = ITEM_COMPONENTS;
export const CHARGE_ITEM_IDS = Object.freeze(["3776945997","787198704","1763073141"]);
export const CHARGE_GRANT_ITEM_IDS = Object.freeze(["424779525"]);
export const HERO_CHARGE_CAPABILITIES = Object.freeze({
  "1": true,
  "2": true,
  "3": true,
  "4": true,
  "6": false,
  "7": true,
  "8": true,
  "10": true,
  "11": true,
  "12": true,
  "13": true,
  "14": true,
  "15": false,
  "16": false,
  "17": true,
  "18": false,
  "19": true,
  "20": true,
  "25": false,
  "27": true,
  "31": true,
  "35": true,
  "50": false,
  "52": true,
  "58": true,
  "60": true,
  "63": false,
  "64": false,
  "65": true,
  "66": true,
  "67": true,
  "69": true,
  "72": true,
  "76": true,
  "77": false,
  "78": false,
  "79": true,
  "80": false,
  "81": true,
  "84": true,
  "85": false
});
export function heroHasChargeAbility(hero) {
  return HERO_CHARGE_CAPABILITIES[String(typeof hero === 'object' && hero !== null ? hero.id : hero)] === true;
}
/** True only for an actual transitive recipe ancestor, never by name similarity. */
export function isUpgradeOf(candidate, ancestor) {
  const target = String(typeof candidate === 'object' && candidate !== null ? candidate.id : candidate);
  const source = String(typeof ancestor === 'object' && ancestor !== null ? ancestor.id : ancestor);
  if (target === source) return false;
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return false;
    visited.add(id);
    return (ITEM_COMPONENTS[id] || []).some(parent => parent === source || visit(parent));
  }
  return visit(target);
}
