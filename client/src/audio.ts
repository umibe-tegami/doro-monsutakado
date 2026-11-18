// Voice / SE / BGM playback. Voice and BGM have independent mute settings.
let voiceMuted = false;
let bgmEnabled = true;
export function setVoiceMuted(m: boolean) { voiceMuted = m; }
export function setBgmEnabled(m: boolean) { bgmEnabled = m; if (!m) stopBgm(); else playBgm(currentTrack); }

export function playVoice(name: string) {
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

let bgmEl: HTMLAudioElement | null = null;
let currentTrack: 'normal' | 'ultimate' = 'normal';
export function playBgm(track: 'normal' | 'ultimate') {
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
    bgmEl.play().catch(() => {});
  } catch { /* ignore */ }
}
export function stopBgm() { try { bgmEl && bgmEl.pause(); } catch { /* ignore */ } }
