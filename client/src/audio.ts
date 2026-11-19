// Voice / SE / BGM playback. Voice and BGM have independent mute settings.
let voiceMuted = false;
let bgmEnabled = true;
export function setVoiceMuted(m: boolean) {
  voiceMuted = m;
  if (m && currentVoice) {
    currentVoice.pause();
    currentVoice.currentTime = 0;
    currentVoice = null;
  }
}
export function setBgmEnabled(m: boolean) { bgmEnabled = m; if (!m) stopBgm(); else playBgm(currentTrack); }

// Callout voices share ONE channel (same as the original game): starting
// a new callout cuts off the one still playing, so callouts can never
// overlap each other.
let currentVoice: HTMLAudioElement | null = null;
export function playVoice(name: string) {
  if (voiceMuted) return;
  try {
    if (currentVoice) {
      currentVoice.pause();
      currentVoice.currentTime = 0;
    }
    const a = new Audio(`/media/voice/${name}.mp3`);
    currentVoice = a;
    a.play().catch(() => {});
  } catch { /* ignore */ }
}
// Independent channel for the mid-run skit lines: they must not cut off
// (or be cut off by) the draw callouts.
export function playVoiceIndependent(name: string) {
  if (voiceMuted) return;
  try {
    const a = new Audio(`/media/voice/${name}.mp3`);
    a.play().catch(() => {});
  } catch { /* ignore */ }
}
export function playSe(name: string) {
  try {
    const a = new Audio(`/media/se/${name}.mp3`);
    a.play().catch(() => {});
  } catch { /* ignore */ }
}
export function vibrate(ms = 200) { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ } }

// Cut whatever callout is currently playing (used when the heavens
// 100-card performance starts: no callouts during the card stream).
export function stopVoice() {
  if (currentVoice) {
    try { currentVoice.pause(); currentVoice.currentTime = 0; } catch { /* ignore */ }
    currentVoice = null;
  }
}

let bgmEl: HTMLAudioElement | null = null;
let currentTrack: 'normal' | 'ultimate' | 'heavens' = 'normal';
export function playBgm(track: 'normal' | 'ultimate' | 'heavens') {
  currentTrack = track;
  if (!bgmEnabled) return;
  try {
    if (!bgmEl) {
      bgmEl = new Audio();
      bgmEl.loop = true;
      bgmEl.volume = 0.32;
    }
    const src = `/media/bgm/${track}.mp3`;
    if (!bgmEl.src.endsWith(src)) bgmEl.src = src;
    if (typeof document !== 'undefined' && document.hidden) { bgmSuspended = true; return; }
    bgmEl.play().catch(() => {});
  } catch { /* ignore */ }
}
export function stopBgm() { try { bgmEl && bgmEl.pause(); } catch { /* ignore */ } }

// When the tab/app goes to the background (task switch, home screen),
// pause the BGM and any callout; resume the BGM when the player comes
// back — but only if it was actually playing when hidden.
let bgmSuspended = false;
function suspendAudio() {
  bgmSuspended = !!(bgmEl && !bgmEl.paused);
  try { bgmEl && bgmEl.pause(); } catch { /* ignore */ }
  stopVoice();
}
function resumeAudio() {
  if (bgmSuspended && bgmEnabled && bgmEl) { bgmEl.play().catch(() => {}); }
  bgmSuspended = false;
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspendAudio(); else resumeAudio();
  });
  window.addEventListener('pagehide', suspendAudio);
  window.addEventListener('pageshow', resumeAudio);
}
