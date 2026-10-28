// Original tracks, verified against the current local game soundevents.
export const MUSIC_TRACKS = Object.freeze([
  {
    "id": "title",
    "name": "Title • current menu",
    "localizedName": "Title • новое меню",
    "path": "assets/audio/music/title.mp3",
    "duration": 170
  },
  {
    "id": "hideout",
    "name": "The Hideout",
    "localizedName": "Убежище",
    "path": "assets/audio/music/hideout.mp3",
    "duration": 43.35485076904297
  },
  {
    "id": "brawl",
    "name": "Street Brawl • draft",
    "localizedName": "Street Brawl • драфт",
    "path": "assets/audio/music/brawl.mp3",
    "duration": 62.52632522583008
  },
  {
    "id": "search",
    "name": "Searching for a match",
    "localizedName": "Поиск матча",
    "path": "assets/audio/music/search.mp3",
    "duration": 75.0968017578125
  },
  {
    "id": "postgame",
    "name": "Post Match",
    "localizedName": "После матча",
    "path": "assets/audio/music/postgame.mp3",
    "duration": 44
  },
  {
    "id": "classic",
    "name": "Classic main menu",
    "localizedName": "Классическое меню",
    "path": "assets/audio/menu.mp3",
    "duration": 247.0264434814453
  }
].map(track => Object.freeze(track)));
export const DEFAULT_MUSIC_TRACK = 'title';
export function normalizeMusicTrack(value) {
  return MUSIC_TRACKS.some(track => track.id === value) ? value : DEFAULT_MUSIC_TRACK;
}
export function getMusicTrack(value) {
  return MUSIC_TRACKS.find(track => track.id === normalizeMusicTrack(value));
}
