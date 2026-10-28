import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../src/audio.js';
import { SOUND_STYLES } from '../src/sound-palette.js';
import { MUSIC_TRACKS, normalizeMusicTrack } from '../src/music-tracks.js';

test('music and roulette click switches operate independently without restarting the menu loop', () => {
  const OriginalAudio = globalThis.Audio;
  let media;
  globalThis.Audio = class {
    constructor(src) {
      this.src = src; this.paused = true; this.currentTime = 0;
      this.readyState = 4; this.duration = 247; this.plays = 0; this.pauses = 0;
      media = this;
    }
    addEventListener() {}
    play() { this.plays++; this.paused = false; return Promise.resolve(); }
    pause() { this.pauses++; this.paused = true; }
  };
  try {
    const manager = new AudioManager();
    manager.setPreferences({ music: true, sound: false, musicVolume: .37, soundVolume: .63 });
    assert.equal(manager.state.musicPlaying, true);
    assert.equal(manager.state.soundEnabled, false);
    assert.equal(manager.state.musicVolume, .37);
    assert.equal(manager.state.soundVolume, .63);
    assert.equal(media.volume, .37);
    assert.equal(media.loop, true);
    assert.ok(media.src.endsWith('/assets/audio/music/title.mp3'));
    media.currentTime = 73;
    manager.setPreferences({ music: true, sound: true, musicVolume: 0, soundVolume: .63 });
    assert.equal(manager.state.soundEnabled, true);
    assert.equal(media.plays, 1);
    assert.equal(media.currentTime, 73);
    assert.equal(media.volume, 0);
    manager.setPreferences({ music: false, sound: true });
    assert.equal(manager.state.musicPlaying, false);
    assert.equal(manager.state.soundEnabled, true);
    manager.setPreferences({ music: true, sound: false });
    assert.equal(manager.state.musicPlaying, true);
    assert.equal(manager.state.soundEnabled, false);
    assert.equal(media.currentTime, 73);
  } finally {
    if (OriginalAudio === undefined) delete globalThis.Audio; else globalThis.Audio = OriginalAudio;
  }
});

function withAudioContext(run) {
  const OriginalContext = globalThis.AudioContext;
  let context;
  const parameter = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime() {},
  });
  const node = fields => ({
    connections: [],
    connect(target) { this.connections.push(target); },
    disconnect() { this.connections = []; },
    start() {}, stop() { this.stopped = true; }, ...fields,
  });
  globalThis.AudioContext = class {
    constructor() {
      this.state = 'running'; this.currentTime = 1; this.sampleRate = 1000;
      this.destination = {}; this.gains = []; this.oscillators = []; this.sources = [];
      context = this;
    }
    createGain() { const gain = node({ gain: parameter() }); this.gains.push(gain); return gain; }
    createOscillator() { const oscillator = node({ frequency: parameter() }); this.oscillators.push(oscillator); return oscillator; }
    createBufferSource() { const source = node({}); this.sources.push(source); return source; }
    createBiquadFilter() { return node({ frequency: parameter() }); }
    createBuffer(channels, length) { const samples = new Float32Array(length); return { getChannelData() { return samples; } }; }
  };
  try { run(() => context); }
  finally { if (OriginalContext === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = OriginalContext; }
}

test('chicken, patrons, die and seals use wheel-effects volume and obey its mute independently', () => {
  withAudioContext(getContext => {
    const manager = new AudioManager();
    manager.setPreferences({ music: false, sound: false, soundVolume: .6, uiSound: true, uiVolume: .4 });
    assert.equal(manager.fate('chicken'), false);
    manager.setPreferences({ music: false, sound: true, soundVolume: .6, uiSound: false, uiVolume: .4 });
    for (const kind of ['chicken', 'dice', 'dice-tick', 'dice-land', 'feather', 'peck', 'archmother', 'king', 'royal-reveal', 'impostor', 'edict', 'reveal', 'wipe']) {
      assert.equal(manager.fate(kind), true);
      assert.equal(manager.state.lastFateSound, kind);
    }
    const context = getContext();
    const outputs = context.gains.filter(gain => gain.connections.includes(context.destination));
    assert.equal(outputs[0].gain.value, .6);
    assert.equal(outputs[1].gain.value, 0);
    const scheduled = context.oscillators.length;
    manager.setPreferences({ music: false, sound: true, soundVolume: 0, uiSound: true, uiVolume: .4 });
    assert.equal(manager.fate('king'), false);
    assert.equal(manager.fate('unknown-event'), false);
    assert.equal(context.oscillators.length, scheduled, 'Muted events schedule no sounds');
  });
});

test('interface feedback has a separate output from muted wheel sounds and suppresses repeated hover', () => {
  withAudioContext(getContext => {
    const manager = new AudioManager();
    manager.setPreferences({ music: false, sound: false, soundVolume: .63, uiSound: true, uiVolume: .41 });
    assert.equal(manager.ui('tap'), true);
    const context = getContext();
    const outputs = context.gains.filter(gain => gain.connections.includes(context.destination));
    assert.equal(outputs.length, 2);
    assert.equal(outputs[0].gain.value, 0);
    assert.equal(outputs[1].gain.value, .41);
    assert.equal(manager.state.uiSoundEnabled, true);
    assert.equal(manager.state.uiVolume, .41);
    assert.ok(context.oscillators.length > 0);
    const before = context.oscillators.length;
    manager.tick();
    manager.victory();
    assert.equal(context.oscillators.length, before);
    assert.equal(manager.ui('hover'), true);
    const firstHover = context.oscillators.length;
    assert.equal(manager.ui('hover'), false);
    assert.equal(context.oscillators.length, firstHover);
    context.currentTime += .1;
    assert.equal(manager.ui('hover'), true);
    manager.setPreferences({ music: false, sound: true, soundVolume: .63, uiSound: false, uiVolume: .41 });
    assert.equal(outputs[0].gain.value, .63);
    assert.equal(outputs[1].gain.value, 0);
    const muted = context.oscillators.length;
    assert.equal(manager.ui('mark'), false);
    assert.equal(context.oscillators.length, muted);
    manager.tick();
    assert.ok(context.oscillators.length > muted);
    assert.equal(context.sources.length, 1);
  });
});

test('zero interface volume schedules no feedback and final recoil follows the wheel channel only', () => {
  withAudioContext(getContext => {
    const manager = new AudioManager();
    manager.setPreferences({ music: false, sound: true, soundVolume: .5, uiSound: true, uiVolume: 0 });
    assert.equal(manager.ui('success'), false);
    assert.equal(getContext(), undefined);
    assert.equal(manager.impact('hero'), true);
    const context = getContext();
    const impactCount = context.oscillators.length;
    assert.ok(impactCount > 0);
    assert.equal(context.sources.length, 1);
    assert.equal(manager.impact('item'), false);
    manager.setPreferences({ music: false, sound: false, soundVolume: .5, uiSound: true, uiVolume: .35 });
    context.currentTime += .2;
    assert.equal(manager.impact('hero'), false);
    assert.equal(context.oscillators.length, impactCount);
    assert.equal(manager.ui('success'), true);
    assert.ok(context.oscillators.length > impactCount);
    manager.setPreferences({ music: false, sound: true, soundVolume: 0, uiSound: true, uiVolume: .35 });
    assert.equal(manager.impact('item'), false);
    assert.equal(manager.state.uiVolume, .35);
    assert.equal(manager.state.soundVolume, 0);
  });
});

test('all palettes differ and an explicit preview bypasses mute without changing preferences', () => {
  const signatures = [];
  for (const style of SOUND_STYLES) {
    withAudioContext(getContext => {
      const manager = new AudioManager();
      manager.setPreferences({ music: false, sound: false, soundVolume: .42, soundStyle: style, uiSound: false });
      assert.equal(manager.preview(style), true);
      const context = getContext();
      assert.equal(manager.state.soundEnabled, false);
      assert.equal(manager.state.soundStyle, style);
      assert.equal(context.gains.find(gain => gain === manager._previewGain).gain.value, .42);
      assert.equal(manager._soundGain.gain.value, 0);
      assert.ok(context.oscillators.length >= 6);
      signatures.push(context.oscillators.slice(0, 2).map(node => `${node.type}:${node.frequency.value}`).join(','));
      const originalNodes = [...manager._previewNodes];
      assert.equal(manager.preview(style), true);
      assert.ok(originalNodes.every(node => node.stopped), 'Changing a sample cancels the previous sample');
      const count = context.oscillators.length;
      assert.equal(manager.tick(), false);
      assert.equal(context.oscillators.length, count);
      manager.setPreferences({ music: false, sound: false, soundVolume: 0, soundStyle: style, uiSound: false });
      assert.equal(manager.preview(style), false);
      assert.equal(context.oscillators.length, count);
    });
  }
  assert.equal(new Set(signatures).size, SOUND_STYLES.length);
});

test('current soundtrack selection crossfades and changing a muted track never starts it', async () => {
  const OriginalAudio = globalThis.Audio;
  const media = [];
  globalThis.Audio = class {
    constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.plays = 0; this.readyState = 4; this.duration = 170; media.push(this); }
    addEventListener() {}
    play() { this.plays++; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  };
  const manager = new AudioManager();
  try {
    assert.equal(MUSIC_TRACKS.length, 6);
    assert.equal(normalizeMusicTrack('unsafe/path'), 'title');
    manager.setPreferences({ music: true, musicTrack: 'title', musicVolume: .4, sound: false });
    const title = media[0];
    title.currentTime = 35;
    manager.setPreferences({ music: true, musicTrack: 'hideout', musicVolume: .4, sound: false });
    const hideout = media[1];
    assert.ok(hideout.src.endsWith('/assets/audio/music/hideout.mp3'));
    assert.equal(title.paused, false, 'Previous soundtrack remains audible during the fade');
    assert.equal(hideout.paused, false);
    assert.equal(hideout.volume, 0, 'New track begins without a volume jump');
    assert.equal(manager.state.musicTrack, 'hideout');
    assert.equal(manager.state.musicSource, 'hideout');
    await new Promise(resolve => setTimeout(resolve, 790));
    assert.equal(title.paused, true);
    assert.equal(title.currentTime, 35);
    assert.equal(hideout.volume, .4);
    manager.setPreferences({ music: true, musicTrack: 'brawl', musicVolume: .4, sound: false });
    const brawl = media[2];
    manager.setPreferences({ music: false, musicTrack: 'search', musicVolume: .23, sound: false });
    const search = media[3];
    assert.equal(hideout.paused, true);
    assert.equal(brawl.paused, true);
    assert.equal(search.paused, true);
    assert.equal(search.plays, 0);
    assert.equal(manager.state.musicPlaying, false);
    assert.equal(manager.state.musicSource, 'search');
    manager.setPreferences({ music: true, musicTrack: 'search', musicVolume: .23, sound: false });
    assert.equal(search.plays, 1);
    assert.equal(search.volume, .23);
    assert.equal(search.loop, true);
    manager.setPreferences({ music: false, musicTrack: 'search', musicVolume: .23, sound: false });
  } finally {
    manager._cancelMusicFade();
    if (OriginalAudio === undefined) delete globalThis.Audio; else globalThis.Audio = OriginalAudio;
  }
});

test('the original Street Brawl shot and category layer follow wheel mute and its saved volume', () => {
  const OriginalAudio = globalThis.Audio;
  const media = [];
  globalThis.Audio = class {
    constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.plays = 0; media.push(this); }
    play() { this.plays++; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() { this.loaded = true; }
  };
  try {
    withAudioContext(getContext => {
      const manager = new AudioManager();
      manager.setPreferences({ music: false, sound: true, soundVolume: .5, soundStyle: 'streetbrawl', uiSound: false });
      assert.equal(manager.impact('item', 'spirit'), true);
      const shot = media.find(clip => clip.src.endsWith('/shot-1.mp3'));
      const spirit = media.find(clip => clip.src.endsWith('/spirit.mp3'));
      assert.equal(shot.paused, false);
      assert.equal(spirit.paused, false);
      assert.equal(shot.volume, .5 * .79);
      assert.equal(spirit.volume, .5 * .71);
      assert.equal(manager.state.lastLandingSource, 'assets/audio/street-brawl/shot-1.mp3');
      manager.setPreferences({ music: false, sound: true, soundVolume: .2, soundStyle: 'streetbrawl', uiSound: false });
      assert.equal(shot.volume, .2 * .79);
      assert.equal(spirit.volume, .2 * .71);
      manager.setPreferences({ music: false, sound: false, soundVolume: .2, soundStyle: 'streetbrawl', uiSound: false });
      assert.equal(shot.paused, true);
      assert.equal(spirit.paused, true);
      getContext().currentTime += .2;
      assert.equal(manager.impact('item', 'weapon'), false);
      assert.equal(media.reduce((sum, clip) => sum + clip.plays, 0), 2);
      manager.setPreferences({ music: false, sound: true, soundVolume: .2, soundStyle: 'streetbrawl', uiSound: false });
      assert.equal(manager.impact('item', 'weapon'), true);
      const nextShot = media.find(clip => clip.src.endsWith('/shot-2.mp3'));
      assert.equal(nextShot.paused, false);
      assert.equal(media.find(clip => clip.src.endsWith('/weapon.mp3')).paused, false);
    });
  } finally { if (OriginalAudio === undefined) delete globalThis.Audio; else globalThis.Audio = OriginalAudio; }
});

test('four staged ability impacts use the wheel volume and stay separate from interface accents', () => {
  withAudioContext(getContext => {
    const manager = new AudioManager();
    manager.setPreferences({ music: false, sound: true, soundVolume: .55, uiSound: false });
    assert.equal(manager.abilityImpact(0), true);
    const context = getContext();
    const frequencies = [context.oscillators[0].frequency.value];
    assert.equal(manager.abilityImpact(1), false, 'The same frame cannot stack thumps');
    for (let index = 1; index < 4; index++) {
      context.currentTime += .26;
      const count = context.oscillators.length;
      assert.equal(manager.abilityImpact(index), true);
      frequencies.push(context.oscillators[count].frequency.value);
    }
    assert.deepEqual(frequencies, [104, 124, 147, 175]);
    assert.equal(manager._soundGain.gain.value, .55);
    assert.equal(manager._uiGain.gain.value, 0);
    manager.setPreferences({ music: false, sound: false, uiSound: true });
    assert.equal(manager.abilityImpact(0), false);
  });
});

test('original hero quotes cancel their predecessor, follow voice preferences and ignore wheel mute', () => {
  const OriginalAudio = globalThis.Audio;
  const media = [];
  globalThis.Audio = class {
    constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.ended = false; this.events = {}; media.push(this); }
    addEventListener(type, listener) { this.events[type] = listener; }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  };
  try {
    const manager = new AudioManager();
    manager.setPreferences({ music: false, sound: false, voices: true, voiceVolume: .53 });
    assert.equal(manager.playHeroVoice('6'), true);
    assert.equal(media[0].volume, .53);
    assert.ok(media[0].src.endsWith('/assets/voices/6.mp3'));
    assert.equal(manager.state.voicePlaying, true);
    assert.equal(manager.state.voiceHeroId, '6');
    media[0].currentTime = 1;
    assert.equal(manager.playHeroVoice('80'), true);
    assert.equal(media[0].paused, true);
    assert.equal(media[0].currentTime, 0);
    assert.equal(manager.state.voiceHeroId, '80');
    media[0].events.ended();
    assert.equal(manager.state.voiceHeroId, '80', 'A stale ended event cannot clear the new quote');
    manager.setPreferences({ music: false, sound: true, voices: false, voiceVolume: .53 });
    assert.equal(media[1].paused, true);
    assert.equal(manager.state.voicePlaying, false);
    assert.equal(manager.state.voiceEnabled, false);
    assert.equal(manager.playHeroVoice('6'), false);
    manager.setPreferences({ music: false, sound: false, voices: true, voiceVolume: 0 });
    assert.equal(manager.playHeroVoice('6'), false);
    manager.setPreferences({ music: false, sound: false, voices: true, voiceVolume: .65 });
    assert.equal(manager.playHeroVoice('unknown'), false);
    assert.equal(media.length, 2);
  } finally { if (OriginalAudio === undefined) delete globalThis.Audio; else globalThis.Audio = OriginalAudio; }
});

test('the original curse accent follows wheel volume and never follows interface or music mute', () => {
  const OriginalAudio = globalThis.Audio;
  const media = [];
  globalThis.Audio = class {
    constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.ended = false; this.plays = 0; media.push(this); }
    addEventListener() {}
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
  };
  try {
    const manager = new AudioManager();
    manager.setPreferences({ music: false, sound: false, uiSound: true, soundVolume: .6 });
    assert.equal(manager.curse(), false);
    assert.equal(media.length, 0);
    manager.setPreferences({ music: false, sound: true, uiSound: false, soundVolume: .6 });
    assert.equal(manager.curse(), true);
    assert.equal(media.length, 1);
    assert.ok(media[0].src.endsWith('/assets/audio/curse.mp3'));
    assert.equal(media[0].volume, .6 * .74);
    assert.equal(manager.state.cursePlaying, true);
    media[0].currentTime = .9;
    manager.setPreferences({ music: false, sound: true, uiSound: true, soundVolume: .2 });
    assert.equal(media[0].volume, .2 * .74);
    assert.equal(media[0].currentTime, .9);
    assert.equal(media[0].plays, 1);
    assert.equal(manager.curse(), true);
    assert.equal(media[0].currentTime, 0);
    assert.equal(media[0].plays, 2);
    assert.equal(media.length, 1, 'The cached accent is reused without layering itself');
    manager.setPreferences({ music: false, sound: false, uiSound: true, soundVolume: .2 });
    assert.equal(media[0].paused, true);
    assert.equal(manager.state.cursePlaying, false);
    assert.equal(manager.curse(), false);
    manager.setPreferences({ music: false, sound: true, uiSound: true, soundVolume: 0 });
    assert.equal(manager.curse(), false);
  } finally { if (OriginalAudio === undefined) delete globalThis.Audio; else globalThis.Audio = OriginalAudio; }
});
