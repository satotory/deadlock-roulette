import heroVoices from './hero-voices.js';
import { normalizeSoundStyle, DEFAULT_SOUND_STYLE, STREET_BRAWL_AUDIO } from './sound-palette.js';
import { normalizeMusicTrack, getMusicTrack, DEFAULT_MUSIC_TRACK } from './music-tracks.js';

/** Music, roulette palettes, original hero voices and UI accents have separate levels. */
export class AudioManager {
  constructor() {
    this.musicEnabled = false;
    this.soundEnabled = false;
    this.uiSoundEnabled = true;
    this.musicVolume = .01;
    this.soundVolume = 1;
    this.uiVolume = .35;
    this.soundStyle = DEFAULT_SOUND_STYLE;
    this.musicTrack = DEFAULT_MUSIC_TRACK;
    this.voicesEnabled = true;
    this.voiceVolume = .65;
    this._voice = null;
    this._voiceHeroId = null;
    this._voiceGeneration = 0;
    this._previewGain = null;
    this._previewNodes = [];
    this._music = null;
    this._retiringMusic = null;
    this._musicFadeTimer = null;
    this._musicSourceId = null;
    this._streetCache = new Map();
    this._streetPlaying = [];
    this._streetPreviewTimer = null;
    this._streetShotIndex = 0;
    this._lastLandingSource = null;
    this._curse = null;
    this._context = null;
    this._clickBuffer = null;
    this._soundGain = null;
    this._uiGain = null;
    this._musicErrorReported = false;
    this._lastClick = 0;
    this._lastImpact = -Infinity;
    this._lastSkillImpact = -Infinity;
    this._lastUi = new Map();
    this._lastFateSound = null;
  }

  get state() {
    return {
      musicEnabled: this.musicEnabled,
      soundEnabled: this.soundEnabled,
      uiSoundEnabled: this.uiSoundEnabled,
      musicVolume: this.musicVolume,
      soundVolume: this.soundVolume,
      uiVolume: this.uiVolume,
      soundStyle: this.soundStyle,
      musicTrack: this.musicTrack,
      voices: this.voicesEnabled,
      voiceEnabled: this.voicesEnabled,
      voiceVolume: this.voiceVolume,
      voicePlaying: Boolean(this._voice && !this._voice.paused && !this._voice.ended),
      voiceHeroId: this._voiceHeroId,
      musicPlaying: Boolean(this._music && !this._music.paused),
      musicReadyState: this._music?.readyState ?? 0,
      musicDuration: Number.isFinite(this._music?.duration) ? this._music.duration : 0,
      musicSource: this._musicSourceId,
      lastLandingSource: this._lastLandingSource,
      cursePlaying: Boolean(this._curse && !this._curse.paused && !this._curse.ended),
      curseSource: this._curse ? 'assets/audio/curse.mp3' : null,
      lastFateSound: this._lastFateSound,
      contextState: this._context?.state ?? 'not-started',
    };
  }

  setPreferences(preferences) {
    const music = preferences.music === true;
    const sound = preferences.sound === true;
    const uiSound = typeof preferences.uiSound === 'boolean' ? preferences.uiSound : true;
    const wasMusicEnabled = this.musicEnabled;
    const wasSoundEnabled = this.soundEnabled;
    const nextTrack = normalizeMusicTrack(preferences.musicTrack);
    this.musicEnabled = music;
    this.soundEnabled = sound;
    this.uiSoundEnabled = uiSound;
    this.soundStyle = normalizeSoundStyle(preferences.soundStyle);
    this.musicTrack = nextTrack;
    this.voicesEnabled = typeof preferences.voices === 'boolean' ? preferences.voices : true;
    const level = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
    this.musicVolume = level(preferences.musicVolume, .01);
    this.soundVolume = level(preferences.soundVolume, 1);
    this.uiVolume = level(preferences.uiVolume, .35);
    this.voiceVolume = level(preferences.voiceVolume, .65);
    if (this._voice) this._voice.volume = this.voiceVolume;
    if (!this.voicesEnabled || this.voiceVolume <= 0) this.stopHeroVoice();
    if (this._music && !this._musicFadeTimer) this._music.volume = this.musicVolume;
    for (const playing of this._streetPlaying) playing.media.volume = this.soundVolume * playing.gain;
    if (this._curse) {
      this._curse.volume = this.soundVolume * .74;
      if (!sound || this.soundVolume <= 0) this.stopCurse();
    }
    if ((wasSoundEnabled && !sound) || this.soundVolume <= 0) this._stopStreetLanding();
    if (this._soundGain) this._soundGain.gain.setValueAtTime(sound ? this.soundVolume : 0, this._context.currentTime);
    if (this._uiGain) this._uiGain.gain.setValueAtTime(uiSound ? this.uiVolume : 0, this._context.currentTime);
    if (this._previewGain) this._previewGain.gain.setValueAtTime(this.soundVolume, this._context.currentTime);
    if (!music) {
      this._cancelMusicFade();
      this._music?.pause();
      // Changing a track while muted prepares its source without playing it.
      if (this._music && this._musicSourceId !== nextTrack) this._createMusic();
    }
    else {
      if (!wasMusicEnabled) this._musicErrorReported = false;
      this._playMusic();
    }
  }

  _reportMusicError(reason) {
    if (this._musicErrorReported || !this.musicEnabled) return;
    this._musicErrorReported = true;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('deadlock-audio-error', { detail: { kind: 'music', reason } }));
    }
  }

  _playMusic() {
    if (!this.musicEnabled) return;
    if (!this._music || this._musicSourceId !== this.musicTrack) this._createMusic();
    if (!this._music.paused) return;
    const media = this._music;
    media.play().catch(error => {
      if (media !== this._music) return;
      if (error.name === 'AbortError') return;
      // A browser preview may require a gesture; unlock() retries on a click.
      if (error.name !== 'NotAllowedError') this._reportMusicError('play');
    });
  }

  _cancelMusicFade() {
    if (this._musicFadeTimer !== null) clearInterval(this._musicFadeTimer);
    this._musicFadeTimer = null;
    this._retiringMusic?.pause();
    this._retiringMusic = null;
    if (this._music) this._music.volume = this.musicVolume;
  }

  _createMusic() {
    const previous = this._music;
    const previousVolume = previous?.volume ?? 0;
    this._cancelMusicFade();
    const track = getMusicTrack(this.musicTrack);
    const media = new Audio(new URL(`../${track.path}`, import.meta.url).href);
    this._music = media;
    this._musicSourceId = track.id;
    this._musicErrorReported = false;
    media.loop = true;
    media.preload = 'auto';
    media.volume = this.musicVolume;
    media.addEventListener('error', () => { if (media === this._music) this._reportMusicError('load'); });
    if (!previous || previous.paused || !this.musicEnabled) { previous?.pause(); return; }
    // The two original streams crossfade; neither stream is synthesized or edited.
    this._retiringMusic = previous;
    media.volume = 0;
    const started = performance.now();
    this._musicFadeTimer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / 720);
      const eased = progress * progress * (3 - 2 * progress);
      previous.volume = previousVolume * (1 - eased);
      media.volume = this.musicVolume * eased;
      if (progress >= 1) this._cancelMusicFade();
    }, 25);
  }

  unlock(force = false) {
    this._playMusic();
    if (!force && !this.soundEnabled && !this.uiSoundEnabled) return;
    if (this.soundStyle === 'streetbrawl') this._warmStreetAudio();
    try {
      if (!this._context) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) return;
        this._context = new Context();
        this._soundGain = this._context.createGain();
        this._soundGain.gain.value = this.soundEnabled ? this.soundVolume : 0;
        this._soundGain.connect(this._context.destination);
        this._uiGain = this._context.createGain();
        this._uiGain.gain.value = this.uiSoundEnabled ? this.uiVolume : 0;
        this._uiGain.connect(this._context.destination);
        const length = Math.floor(this._context.sampleRate * .024);
        this._clickBuffer = this._context.createBuffer(1, length, this._context.sampleRate);
        const channel = this._clickBuffer.getChannelData(0);
        const noise = crypto.getRandomValues(new Uint32Array(length));
        for (let index = 0; index < length; index++) {
          const envelope = Math.exp(-index / (length * .15));
          channel[index] = (noise[index] / 0x80000000 - 1) * envelope;
        }
      }
      if (this._context.state === 'suspended') this._context.resume().catch(() => {});
    } catch {
      // Sound failures never interrupt a draw or affect its randomness.
    }
  }

  tick() {
    if (!this.soundEnabled || this.soundVolume <= 0 || this._context?.state !== 'running' || !this._clickBuffer) return false;
    const now = this._context.currentTime;
    if (now - this._lastClick < .032) return false;
    this._lastClick = now;
    this._paletteTick(this.soundStyle, now, this._soundGain);
    return true;
  }

  _noise(start, duration, volume, frequency, type, output) {
    const click = this._context.createBufferSource();
    const filter = this._context.createBiquadFilter();
    const gain = this._context.createGain();
    click.buffer = this._clickBuffer;
    filter.type = type;
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    click.connect(filter); filter.connect(gain); gain.connect(output);
    click.onended = () => { click.disconnect(); filter.disconnect(); gain.disconnect(); };
    click.start(start); click.stop(start + Math.min(.024, duration) + .005);
    if (output === this._previewGain) this._previewNodes.push(click);
  }

  _scheduleTone(frequency, duration, volume, type, start, output, endFrequency = frequency) {
    const oscillator = this._context.createOscillator();
    const gain = this._context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .002);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain); gain.connect(output);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start); oscillator.stop(start + duration);
    if (output === this._previewGain) this._previewNodes.push(oscillator);
  }

  _tone(frequency, duration, volume, type = 'sine', delay = 0) {
    if (!this.soundEnabled || this._context?.state !== 'running') return;
    this._scheduleTone(frequency, duration, volume, type, this._context.currentTime + delay, this._soundGain);
  }

  _paletteTick(style, start, output) {
    const tone = (frequency, duration, volume, type = 'sine', end = frequency) => this._scheduleTone(frequency, duration, volume, type, start, output, end);
    if (style === 'streetbrawl') {
      // A boundary-driven click avoids the game's fixed 5.2-second spin recording
      // running faster than a slowing reel. The landing uses original audio below.
      this._noise(start, .014, .11, 2100, 'highpass', output);
      tone(1210, .034, .031, 'triangle', 860);
      tone(165, .035, .035, 'sine', 105);
    } else if (style === 'wood') {
      this._noise(start, .016, .13, 520, 'lowpass', output);
      tone(380, .065, .10, 'sine', 190);
      tone(740, .026, .022, 'triangle', 470);
    } else if (style === 'revolver') {
      this._noise(start, .019, .20, 1750, 'highpass', output);
      tone(1450, .038, .030, 'triangle', 1060);
      tone(215, .048, .057, 'sine', 145);
    } else if (style === 'crystal') {
      tone(1568, .10, .026);
      tone(3136, .059, .012);
      this._noise(start, .011, .035, 3200, 'highpass', output);
    } else if (style === 'arcade') {
      tone(880, .042, .022, 'square', 440);
      tone(220, .052, .035, 'triangle', 165);
    } else {
      this._noise(start, .027, .4, 1350, 'highpass', output);
      tone(720, .028, .07, 'triangle');
    }
  }

  victory() {
    if (this.soundStyle === 'revolver') {
      this._tone(220, .14, .075, 'triangle');
      this._tone(440, .18, .029, 'sine', .1);
    } else {
      const notes = this.soundStyle === 'crystal' ? [1046.5, 1318.5, 1568] : [523.25, 659.25, 783.99];
      notes.forEach((frequency, index) => this._tone(frequency, .30, this.soundStyle === 'arcade' ? .016 : .030, this.soundStyle === 'arcade' ? 'triangle' : 'sine', index * .09));
    }
  }

  /** The reel's final recoil shares its switch and gain with mechanical ticks. */
  impact(kind = 'item', category = null) {
    if (!this.soundEnabled || this.soundVolume <= 0) return false;
    this.unlock();
    if (this._context?.state !== 'running' || !this._clickBuffer) return false;
    const now = this._context.currentTime;
    if (now - this._lastImpact < .1) return false;
    this._lastImpact = now;
    this._paletteImpact(this.soundStyle, now, this._soundGain, kind, category);
    return true;
  }

  _paletteImpact(style, start, output, kind = 'item', category = null) {
    if (style === 'streetbrawl' && typeof Audio !== 'undefined') {
      const delay = Math.max(0, (start - this._context.currentTime) * 1000);
      const bypassMute = output === this._previewGain;
      const play = () => { this._streetPreviewTimer = null; this._playStreetLanding(kind, category, bypassMute); };
      if (delay > 5) this._streetPreviewTimer = setTimeout(play, delay);
      else play();
      return;
    }
    const tone = (frequency, duration, volume, type = 'sine', delay = 0, end = frequency) => this._scheduleTone(frequency, duration, volume, type, start + delay, output, end);
    tone(kind === 'hero' ? 92 : 118, .18, style === 'crystal' ? .10 : .17, 'sine', 0, 64);
    if (style === 'crystal') {
      tone(1318.5, .24, .032, 'sine', .025);
      tone(1976, .22, .025, 'sine', .065);
    } else if (style === 'arcade') {
      tone(440, .09, .029, 'square', .025, 880);
      tone(1320, .12, .025, 'triangle', .105);
    } else {
      const wooden = style === 'wood';
      tone(wooden ? 440 : 310, .065, wooden ? .051 : .09, 'triangle', .02, wooden ? 280 : 310);
      this._noise(start + .035, .024, wooden ? .16 : .28, wooden ? 720 : 1750, wooden ? 'lowpass' : 'highpass', output);
      if (!wooden) tone(1860, .075, .026, 'sine', .045);
    }
  }

  abilityImpact(index = 0) {
    if (!this.soundEnabled || this.soundVolume <= 0) return false;
    this.unlock();
    if (this._context?.state !== 'running' || !this._clickBuffer) return false;
    const now = this._context.currentTime;
    if (now - this._lastSkillImpact < .09) return false;
    this._lastSkillImpact = now;
    const slot = Math.min(3, Math.max(0, Math.floor(Number(index) || 0)));
    const frequency = [104, 124, 147, 175][slot];
    this._scheduleTone(frequency, .17, .15, 'sine', now, this._soundGain, frequency * .58);
    this._scheduleTone(frequency * 3, .075, .032, 'triangle', now + .015, this._soundGain, frequency * 1.5);
    this._noise(now + .006, .018, .10, 920, 'lowpass', this._soundGain);
    if (slot === 3) this._scheduleTone(880, .2, .021, 'sine', now + .07, this._soundGain, 1320);
    return true;
  }

  /** Original Cursed Relic cast. Its mute and gain follow wheel effects only. */
  curse() {
    if (!this.soundEnabled || this.soundVolume <= 0 || typeof Audio === 'undefined') return false;
    try {
      if (!this._curse) {
        this._curse = new Audio(new URL('../assets/audio/curse.mp3', import.meta.url).href);
        this._curse.preload = 'auto';
      }
      this._curse.pause();
      this._curse.currentTime = 0;
      this._curse.volume = this.soundVolume * .74;
      this._curse.play().catch(() => {});
      return true;
    } catch { return false; }
  }

  stopCurse() {
    if (!this._curse) return;
    this._curse.pause();
    try { this._curse.currentTime = 0; } catch {}
  }

  /** Fate characters share the draw-effects mute and volume, never the music or UI output. */
  fate(kind) {
    const kinds = ['chicken', 'dice', 'dice-tick', 'dice-land', 'feather', 'peck', 'archmother', 'king', 'royal-reveal', 'impostor', 'edict', 'reveal', 'wipe'];
    if (!kinds.includes(kind) || !this.soundEnabled || this.soundVolume <= 0) return false;
    this.unlock();
    if (this._context?.state !== 'running' || !this._soundGain || !this._clickBuffer) return false;
    this._lastFateSound = kind;
    const start = this._context.currentTime;
    const tone = (hz, duration, gain, type = 'sine', delay = 0, end = hz) =>
      this._scheduleTone(hz, duration, gain, type, start + delay, this._soundGain, end);
    const noise = (delay, duration, gain, hz, type = 'bandpass') =>
      this._noise(start + delay, duration, gain, hz, type, this._soundGain);
    if (kind === 'chicken') {
      // Three rounded, raspy clucks, with a longer indignant squawk at the end.
      [[0, .13, 780, 360], [.19, .14, 880, 420], [.41, .27, 1030, 480]].forEach(([delay, duration, hz, end]) => {
        tone(hz, duration, .074, 'triangle', delay, end);
        tone(hz * .51, duration * .9, .049, 'sine', delay + .01, end * .6);
        noise(delay + .015, duration * .85, .14, 1450);
      });
    } else if (kind === 'dice') {
      [0, .06, .15, .28, .46, .70, .99].forEach((delay, index) => {
        tone(420 - index * 19, .045, .055, 'triangle', delay, 220);
        noise(delay, .018, .14, 850, 'lowpass');
      });
    } else if (kind === 'dice-tick') {
      tone(380, .035, .05, 'triangle', 0, 230);
      noise(0, .013, .095, 880, 'lowpass');
    } else if (kind === 'dice-land') {
      tone(245, .115, .08, 'triangle', 0, 150);
      noise(0, .024, .16, 720, 'lowpass');
      tone(390, .06, .03, 'triangle', .075, 240);
    } else if (kind === 'feather') {
      noise(0, .18, .08, 1600);
      noise(.05, .14, .045, 2300, 'highpass');
    } else if (kind === 'peck') {
      tone(410, .06, .075, 'triangle', 0, 180);
      noise(.004, .025, .19, 1100, 'highpass');
    } else if (kind === 'archmother') {
      [523.25, 659.25, 783.99, 1046.5].forEach((hz, index) => tone(hz, .45, .039, 'sine', index * .08));
      tone(1568, .62, .019, 'sine', .18, 2093);
      noise(.025, .12, .065, 1900);
    } else if (kind === 'king') {
      tone(82.4, .65, .12, 'sine', 0, 55);
      [311.1, 293.7, 233.1].forEach((hz, index) => tone(hz, .33, .027, 'triangle', index * .15, hz * .75));
      noise(.04, .28, .095, 510, 'lowpass');
    } else if (kind === 'royal-reveal') {
      noise(0, .06, .12, 1600, 'highpass');
      [392, 493.88, 587.33].forEach((hz, index) => tone(hz, .36, .045, 'triangle', .035 + index * .07, hz * 1.02));
      tone(1174.66, .32, .02, 'sine', .20);
    } else if (kind === 'impostor') {
      noise(0, .08, .15, 850, 'lowpass');
      tone(370, .40, .075, 'sawtooth', 0, 110);
      tone(196, .45, .055, 'sine', .06, 65);
    } else if (kind === 'edict') {
      tone(98, .38, .10, 'sine', 0, 65);
      noise(.01, .04, .16, 1300, 'highpass');
      [293.66, 392, 587.33].forEach((hz, index) => tone(hz, .32, .03, 'triangle', .12 + index * .055));
    } else if (kind === 'reveal') {
      noise(0, .045, .12, 1600, 'highpass');
      tone(523.25, .19, .043, 'sine', .025, 784);
      tone(1046.5, .22, .018, 'sine', .065, 1174.7);
    } else {
      tone(65.4, .65, .19, 'sine', 0, 35);
      tone(220, .27, .045, 'triangle', .015, 55);
      noise(.015, .17, .21, 1300, 'highpass');
    }
    return true;
  }

  /** Preview is explicit: it bypasses mute but keeps the saved wheel volume. */
  preview(style = this.soundStyle) {
    if (this.soundVolume <= 0) return false;
    this.unlock(true);
    if (!this._context || !this._clickBuffer) return false;
    for (const node of this._previewNodes) { try { node.stop(); } catch {} }
    if (this._streetPreviewTimer !== null) clearTimeout(this._streetPreviewTimer);
    this._streetPreviewTimer = null;
    this._stopStreetLanding();
    this._previewNodes = [];
    if (!this._previewGain) {
      this._previewGain = this._context.createGain();
      this._previewGain.connect(this._context.destination);
    }
    this._previewGain.gain.setValueAtTime(this.soundVolume, this._context.currentTime);
    const start = this._context.currentTime + .04;
    const palette = normalizeSoundStyle(style);
    [.0, .12, .27, .46, .72, 1.03].forEach(delay => this._paletteTick(palette, start + delay, this._previewGain));
    this._paletteImpact(palette, start + 1.43, this._previewGain);
    return true;
  }

  _warmStreetAudio() {
    if (typeof Audio === 'undefined') return;
    for (const source of [...STREET_BRAWL_AUDIO.shots, ...Object.values(STREET_BRAWL_AUDIO.layers)]) {
      if (this._streetCache.has(source)) continue;
      try {
        const media = new Audio(new URL(`../${source}`, import.meta.url).href);
        media.preload = 'auto';
        media.load?.();
        this._streetCache.set(source, media);
      } catch { /* Optional effects cannot interrupt a draw. */ }
    }
  }

  _stopStreetLanding() {
    for (const { media } of this._streetPlaying) { media.pause(); try { media.currentTime = 0; } catch {} }
    this._streetPlaying = [];
  }

  /** Original Street Brawl base gunshot, with the game's item-category layer. */
  _playStreetLanding(kind, category, bypassMute = false) {
    if ((!this.soundEnabled && !bypassMute) || this.soundVolume <= 0) return false;
    this._warmStreetAudio();
    this._stopStreetLanding();
    const source = STREET_BRAWL_AUDIO.shots[this._streetShotIndex++ % STREET_BRAWL_AUDIO.shots.length];
    const clips = [{ source, gain: kind === 'hero' ? .54 : .79 }];
    const layer = STREET_BRAWL_AUDIO.layers[category];
    if (kind === 'item' && layer) clips.push({ source: layer, gain: .71 });
    for (const clip of clips) {
      const media = this._streetCache.get(clip.source);
      if (!media) continue;
      try {
        media.currentTime = 0;
        media.volume = this.soundVolume * clip.gain;
        this._streetPlaying.push({ media, gain: clip.gain });
        media.play().catch(() => {});
      } catch { /* Muted or unavailable sound leaves game state untouched. */ }
    }
    this._lastLandingSource = source;
    return this._streetPlaying.length > 0;
  }

  stopHeroVoice() {
    this._voiceGeneration++;
    if (this._voice) {
      this._voice.pause();
      try { this._voice.currentTime = 0; } catch {}
    }
    this._voice = null;
    this._voiceHeroId = null;
  }

  /** One real selection line per hero, played locally and never overlaid. */
  playHeroVoice(heroId) {
    this.stopHeroVoice();
    const id = String(heroId);
    const quote = heroVoices[id];
    if (!this.voicesEnabled || this.voiceVolume <= 0 || !quote || typeof Audio === 'undefined') return false;
    try {
      const generation = this._voiceGeneration;
      const voice = new Audio(new URL(`../${quote.path}`, import.meta.url).href);
      voice.volume = this.voiceVolume;
      voice.preload = 'auto';
      this._voice = voice;
      this._voiceHeroId = id;
      const clear = () => {
        if (generation === this._voiceGeneration && this._voice === voice) {
          this._voice = null;
          this._voiceHeroId = null;
        }
      };
      voice.addEventListener('ended', clear, { once: true });
      voice.addEventListener('error', clear, { once: true });
      voice.play().catch(clear);
      return true;
    } catch { this.stopHeroVoice(); return false; }
  }

  /** Quiet material accents are generated locally; no media files or requests. */
  ui(kind = 'tap') {
    if (!this.uiSoundEnabled || this.uiVolume <= 0) return false;
    this.unlock();
    if (this._context?.state !== 'running' || !this._uiGain) return false;
    const accents = {
      hover: [[1568, .045, .023, 'sine', 0, 1470]],
      tap: [[620, .065, .072, 'triangle', 0, 390], [1860, .035, .014, 'sine', 0, 1320]],
      toggle: [[740, .12, .048, 'sine', 0, 830], [1110, .11, .025, 'sine', .025, 1245]],
      mark: [[1174, .1, .052, 'sine', 0, 1318], [1760, .13, .031, 'sine', .03, 1976]],
      open: [[392, .15, .048, 'sine', 0, 523], [588, .12, .024, 'sine', .03, 784]],
      close: [[659, .13, .05, 'sine', 0, 392], [988, .09, .024, 'sine', .015, 588]],
      success: [[784, .22, .042, 'sine', 0, 784], [988, .24, .035, 'sine', .045, 988], [1174, .29, .03, 'sine', .09, 1174]],
    };
    if (!Object.hasOwn(accents, kind)) kind = 'tap';
    const now = this._context.currentTime;
    const gap = kind === 'hover' ? .09 : .035;
    if (now - (this._lastUi.get(kind) ?? -Infinity) < gap) return false;
    this._lastUi.set(kind, now);
    for (const accent of accents[kind]) this._uiTone(...accent);
    return true;
  }

  _uiTone(frequency, duration, volume, type, delay, endFrequency) {
    const start = this._context.currentTime + delay;
    const oscillator = this._context.createOscillator();
    const gain = this._context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    // A short attack avoids a harsh click, followed by a clean natural tail.
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .004);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain); gain.connect(this._uiGain);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start); oscillator.stop(start + duration + .01);
  }
}

export const audio = new AudioManager();
