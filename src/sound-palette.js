export const SOUND_STYLES = Object.freeze(['streetbrawl', 'wood', 'revolver', 'crystal', 'arcade', 'mechanical']);
export const DEFAULT_SOUND_STYLE = 'streetbrawl';

export const STREET_BRAWL_AUDIO = Object.freeze({
  shots: Object.freeze(Array.from({ length: 5 }, (_, index) => `assets/audio/street-brawl/shot-${index + 1}.mp3`)),
  layers: Object.freeze({
    weapon: 'assets/audio/street-brawl/weapon.mp3',
    vitality: 'assets/audio/street-brawl/vitality.mp3',
    spirit: 'assets/audio/street-brawl/spirit.mp3',
  }),
});

export function normalizeSoundStyle(value) {
  return SOUND_STYLES.includes(value) ? value : DEFAULT_SOUND_STYLE;
}
