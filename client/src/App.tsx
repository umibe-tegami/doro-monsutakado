import { useCallback, useEffect, useRef, useState} from 'react';
import { api, playerId, type PlayerState, type Rankings} from './api';
import {
SPECIES, SPECIES_MAP, RARITY_MAP, RARITIES, BACKGROUNDS, CARD_BACKS, DEFAULT_BACK,
drawSpeciesId, formatElapsed, UL_ID,
} from './data';
import MonsterArt from './MonsterArt';
import CardBack from './CardBack';
import * as au from './audio';

type Mode = 'normal' | 'super' | 'ultra' | 'ultimate';
type View = 'title' | 'battle' | 'dex' | 'shop' | 'ranking';

interface Battle {
active: boolean;
mode: Mode;
streak: number;
damage: number;
superLeft: number;
ultraReserved: boolean;
guarantee: number;
revivesUsed: number;
skitPlayed: boolean;
lastCards: number[];
lastNew: boolean[];
}
const freshBattle = (): Battle => ({
active: true, mode: 'normal', streak: 0, damage: 0, superLeft: 0,
ultraReserved: false, guarantee: 0, revivesUsed: 0, skitPlayed: false, lastCards: [], lastNew: [],
});
const BKEY = 'doro-battle-v1';
function loadBattle(): Battle | null {
try { const s = localStorage.getItem(BKEY); return s? (JSON.parse(s) as Battle): null;} catch { return null;}
}

interface Ann { title: string; sub?: string; tone: Mode | 'fall' | 'info'}
// Formal mode names, matched to the original game. The badge uses the
// original's badge wording; the side rails use its full rail names.
const MODE_LABEL: Record<Mode, string> = { normal: '通常モード', super: 'スーパーモンスタードローモード', ultra: 'ウルトラモンスターカードドローモード', ultimate: 'アルティメットドローモード'};
const RAIL_LABEL: Record<Mode, string> = { normal: '', super: 'スーパーモンスタードローモード', ultra: 'ウルトラモンスターカードドローモード', ultimate: 'アルティメットモンスターカードドローモード'};

// Draw pacing, matched to the original game: the draw callout starts on
// tap and the result resolves 1850ms later, so the monster callout never
// overlaps the draw callout.
const DRAW_BEAT_MS = 1850;
// One-beat pause on a mode fall: the 「通常モードへ」 card is shown for
// this long before the mode actually drops back to normal.
const FALL_BEAT_MS = 1400;
// One-beat pause when a run ends on a miss, before the revive / result
// flow takes over.
const END_BEAT_MS = 1500;
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

interface Notice { text: string; tone: 'up' | 'down' | 'info'; seq: number}

const PREMIUM: { id: string; name: string; price: string; url: string; desc: string}[] = [
{ id: 'ad_free', name: '広告無期限廃止', price: '¥280', url: 'https://buy.stripe.com/fZu00jeXN3Z26Nmfv82VG00', desc: '自己蘇生に広告が不要になります'},
{ id: 'souls300', name: '300ソウル', price: '¥120', url: 'https://buy.stripe.com/14A8wPaHxfHK5Ji96K2VG02', desc: ''},
{ id: 'souls1000', name: '1,000ソウル', price: '¥320', url: 'https://buy.stripe.com/9B6dR98zpbrugnW0Ae2VG03', desc: ''},
{ id: 'souls2500', name: '2,500ソウル', price: '¥680', url: 'https://buy.stripe.com/28E00jg1R9jm6Nm4Qu2VG04', desc: ''},
{ id: 'souls5500', name: '5,500ソウル', price: '¥1,280', url: 'https://buy.stripe.com/6oU00j6rh0MQdbKfv82VG05', desc: ''},
{ id: 'souls14000', name: '14,000ソウル', price: '¥2,940', url: 'https://buy.stripe.com/4gM6oH9DtfHK7Rqdn02VG06', desc: ''},
{ id: 'souls30000', name: '30,000ソウル', price: '¥5,860', url: 'https://buy.stripe.com/14A8wPeXNgLOc7G1Ei2VG07', desc: ''},
];

// Append the player id so the Stripe webhook can auto-grant the purchase
// to this player (checkout.session.completed -> client_reference_id).
function stripeUrl(url: string): string {
const sep = url.includes('?')? '&': '?';
return `${url}${sep}client_reference_id=${encodeURIComponent(playerId())}`;
}

export default function App() {
const [player, setPlayer] = useState<PlayerState | null>(null);
const [view, setView] = useState<View>('title');
const [battle, setBattle] = useState<Battle | null>(() => loadBattle());
const [ann, setAnn] = useState<Ann | null>(null);
const [notice, setNotice] = useState<Notice | null>(null);
const [skit, setSkit] = useState<number>(-1);
const [showIntro, setShowIntro] = useState(false);
const [showRevive, setShowRevive] = useState(false);
const [showAd, setShowAd] = useState(false);
const [showResult, setShowResult] = useState(false);
const [showFlow, setShowFlow] = useState(false);
const [busy, setBusy] = useState(false);
const battleRef = useRef<Battle | null>(battle);
battleRef.current = battle;
const playerRef = useRef<PlayerState | null>(player);
playerRef.current = player;

const refresh = useCallback(async () => {
const st = await api.state();
setPlayer(st);
au.setVoiceMuted(st.voiceMuted);
au.setBgmEnabled(st.bgmEnabled);
return st;
}, []);
useEffect(() => { refresh().catch(() => {});}, [refresh]);

useEffect(() => {
if (battle) localStorage.setItem(BKEY, JSON.stringify(battle));
}, [battle]);

// BGM: battle uses the ultimate track only in ultimate mode.
useEffect(() => {
if (view === 'battle' && player?.bgmEnabled) au.playBgm(battle?.mode === 'ultimate'? 'ultimate': 'normal');
if (!player?.bgmEnabled) au.stopBgm();
}, [view, battle?.mode, player?.bgmEnabled]);

const announce = useCallback((a: Ann, ms = 1800) => {
setAnn(a);
window.setTimeout(() => setAnn((cur) => (cur === a? null: cur)), ms);
}, []);

// Live commentary banner (same texts / tones as the original game).
// It stays up until the next draw starts; it is not auto-dismissed.
const showNotice = useCallback((text: string, tone: Notice['tone']) => {
setNotice({ text, tone, seq: Date.now()});
}, []);

const playSkit = useCallback(() => {
const lines = ['friend_stop', 'self_shake', 'friend_zero'];
lines.forEach((v, i) => {
window.setTimeout(() => { setSkit(i); au.playVoiceIndependent(v);}, i * 1400);
});
window.setTimeout(() => setSkit(-1), lines.length * 1400 + 400);
}, []);

const drawCards = useCallback(async (n: number, B: Battle, beat: () => Promise<void>) => {
const ids: number[] = [];
const news: boolean[] = [];
for (let i = 0; i < n; i++) {
const sid = drawSpeciesId();
const r = await api.recordDraw(sid);
ids.push(sid); news.push(r.isNew);
}
if (n > 0) await api.awardSouls(n);
// Wait out the draw callout before the result (and its callout) lands.
await beat();
B.streak += ids.length;
B.damage += 1500 * ids.length;
B.lastCards = ids;
B.lastNew = news;
if (ids.length) au.playVoice('monster');
return ids;
}, []);

const finishRun = useCallback(() => { setShowResult(true);}, []);

const doDraw = useCallback(async () => {
const B0 = battleRef.current;
if (!B0 ||!B0.active || busy) return;
setBusy(true);
setNotice(null);
au.playVoice('draw');
const startedAt = Date.now();
// The result of a draw resolves on this beat (see DRAW_BEAT_MS).
const beat = async () => { const w = DRAW_BEAT_MS - (Date.now() - startedAt); if (w > 0) await sleep(w);};
const B: Battle = {...B0};
const prevStreak = B.streak;
let ended = false;
try {
if (B.mode === 'normal') {
const r = Math.random();
if (r < 0.10) {
await beat();
B.mode = 'super'; B.superLeft = 3; B.ultraReserved = false;
au.playSe('garo_navi'); au.vibrate(220);
announce({ title: 'スーパーモンスタードローモード突入！！', sub: 'ここから3回、確定でモンスターが引ける！', tone: 'super'});
} else if (r < 0.30) {
ended = true;
} else {
await drawCards(1, B, beat);
}
} else if (B.mode === 'super') {
await drawCards(1, B, beat);
if (Math.random() < 0.234) B.ultraReserved = true;
B.superLeft -= 1;
if (B.superLeft <= 0) {
if (B.ultraReserved) {
B.mode = 'ultra'; B.guarantee = 3;
au.playSe('garo_navi'); au.vibrate(260);
announce({ title: 'ウルトラモンスターカードドローモード昇格！！', sub: '一気に3枚ドローのチャンス！', tone: 'ultra'});
showNotice('ウルトラモンスターカードドローモード昇格！！', 'up');
} else {
B.mode = 'normal';
announce({ title: '通常モードへ', sub: '連チャンは継続中！', tone: 'info'});
showNotice('スーパーモンスタードロー終了 ― 通常モードへ', 'down');
}
}
} else if (B.mode === 'ultra') {
const guaranteed = B.guarantee > 0;
if (B.guarantee > 0) B.guarantee -= 1;
const r = Math.random();
if (r < 0.40) await drawCards(1, B, beat);
else if (r < 0.75) { await drawCards(3, B, beat); showNotice('一気に3枚ドロー！！', 'up');}
else if (r < 0.85) {
await beat();
B.mode = 'ultimate'; B.guarantee = 5;
au.playSe('garo_shutsugen'); au.vibrate(400);
announce({ title: 'アルティメットドローモード昇格！！', sub: '最上位モード突入！', tone: 'ultimate'});
} else if (guaranteed) {
await drawCards(1, B, beat);
} else {
// Fall to normal: hold one beat on the announcement card (draw
// button stays disabled via `busy`) before the mode actually drops.
await beat();
announce({ title: '通常モードへ', sub: '転落…でも連チャンは継続中！', tone: 'fall'}, FALL_BEAT_MS);
await sleep(FALL_BEAT_MS);
B.mode = 'normal';
}
} else { // ultimate
const guaranteed = B.guarantee > 0;
if (B.guarantee > 0) B.guarantee -= 1;
const r = Math.random();
if (r < 0.30) await drawCards(1, B, beat);
else if (r < 0.90) { await drawCards(5, B, beat); showNotice('一気に5枚ドロー！！', 'up');}
else if (guaranteed) await drawCards(1, B, beat);
else {
await beat();
announce({ title: '通常モードへ', sub: '転落…でも連チャンは継続中！', tone: 'fall'}, FALL_BEAT_MS);
await sleep(FALL_BEAT_MS);
B.mode = 'normal';
}
}
} catch (e) { /* network hiccup: keep state */}
setBattle(B);
battleRef.current = B;
await refresh().catch(() => {});
if (ended) {
// Run ends on a miss: hold one beat on the 「残念！！」 card before
// the revive offer / result flow appears.
await beat();
au.playVoice('miss');
announce({ title: '残念！！', sub: `${B.streak}連チャンで終了`, tone: 'fall'}, END_BEAT_MS);
await sleep(END_BEAT_MS);
setBusy(false);
if (B.revivesUsed < 2) setShowRevive(true);
else finishRun();
return;
}
setBusy(false);
if (!B.skitPlayed && Math.floor(B.streak / 5) > Math.floor(prevStreak / 5) && B.streak > 0) {
const B2: Battle = {...B, skitPlayed: true};
setBattle(B2);
battleRef.current = B2;
window.setTimeout(playSkit, 500);
}
}, [busy, drawCards, announce, refresh, playSkit, finishRun, showNotice]);

const startRun = useCallback(() => {
if (battleRef.current?.active) { setView('battle'); return;}
const B = freshBattle();
setBattle(B); battleRef.current = B;
setNotice(null);
setView('battle');
setShowIntro(true);
au.playVoice('intro');
}, []);

const doRevive = useCallback(async (method: 'souls' | 'ad') => {
const B0 = battleRef.current;
if (!B0) return;
if (method === 'souls') {
try { await api.payRevive();} catch { return;}
}
const B: Battle = {...B0, revivesUsed: B0.revivesUsed + 1};
if (B.revivesUsed >= 2) { B.mode = 'ultra'; B.guarantee = 3;}
else B.mode = 'normal';
setBattle(B); battleRef.current = B;
setShowRevive(false); setShowAd(false);
await refresh().catch(() => {});
if (B.mode === 'ultra') { au.playSe('garo_navi'); au.vibrate(260);}
announce({ title: '自己蘇生！！', sub: B.mode === 'ultra'? 'ウルトラモンスターカードドローモードから再開！': '通常モードから再開！', tone: B.mode === 'ultra'? 'ultra': 'info'});
if (B.mode === 'ultra') showNotice('自己蘇生！ ウルトラモンスターカードドローモードから再開！！', 'up');
else showNotice('自己蘇生！ 通常モードから再開', 'info');
}, [refresh, announce, showNotice]);

const submitAndClose = useCallback(async (name: string) => {
const B = battleRef.current;
if (B) { try { await api.submitScore(name, B.streak);} catch { /* ignore */}}
localStorage.setItem('doro-name', name);
setShowResult(false);
setNotice(null);
setBattle(null); battleRef.current = null;
localStorage.removeItem(BKEY);
await refresh().catch(() => {});
setView('title');
}, [refresh]);

if (!player) return <div className="app"><div className="view"><p>読み込み中…</p></div></div>;

const life = 3000 - (battle?.damage || 0);
const selBg = BACKGROUNDS.find((b) => b.id === player.selectedBg);
const selBack = CARD_BACKS.find((b) => b.id === player.selectedBack) || DEFAULT_BACK;

return (
<div className="app">
<div className="topbar">
<div className="logo-mini">ドロモン</div>
<div className="tabs">
<button className={view === 'battle' || view === 'title'? 'on': ''} onClick={() => (battle?.active? setView('battle'): setView('title'))}>対戦</button>
<button className={view === 'dex'? 'on': ''} onClick={() => setView('dex')}>図鑑</button>
<button className={view === 'shop'? 'on': ''} onClick={() => setView('shop')}>ショップ</button>
<button className={view === 'ranking'? 'on': ''} onClick={() => setView('ranking')}>ランキング</button>
</div>
<button className={`iconbtn ${player.bgmEnabled? '': 'off'}`} title="BGM" onClick={async () => { const st = await api.settings({ bgmEnabled:!player.bgmEnabled}); setPlayer(st);}}>♪</button>
<button className={`iconbtn ${player.voiceMuted? 'off': ''}`} title="ボイス" onClick={async () => { const st = await api.settings({ voiceMuted:!player.voiceMuted}); setPlayer(st); au.setVoiceMuted(st.voiceMuted);}}>声</button>
</div>
<div className="soulsbar">
<span>ソウル <b>{player.souls.toLocaleString()}</b></span>
<span>図鑑 {Object.keys(player.collection).length} / {SPECIES.length}</span>
<button className="iconbtn" onClick={() => setShowFlow(true)}>フロー図</button>
</div>

{view === 'title' && (
<div className="view">
<div className="title-wrap">
<div className="game-logo">ドロー<br />モンスター<br />カード</div>
<p className="note" style={{ textAlign: 'center'}}>引くたびモンスター、1枚1500ダメージ。<br />外れるまで終われない速攻魔法。</p>
<button className="bigbtn" onClick={startRun}>{battle?.active? '対戦を再開する': 'デュエル開始！'}</button>
<button className="subbtn" onClick={() => setView('dex')}>図鑑を見る</button>
<button className="subbtn" onClick={() => setView('shop')}>ショップ</button>
<button className="subbtn" onClick={() => setView('ranking')}>ランキング</button>
<button className="subbtn" onClick={() => setShowFlow(true)}>ゲームフロー図</button>
</div>
</div>
)}

{view === 'battle' && battle && (
<div className="view" style={{ paddingLeft: battle.mode!== 'normal'? 40: 12, paddingRight: battle.mode!== 'normal'? 40: 12}}>
<div className="battle-bg" style={selBg? { backgroundImage: `url(/media/bg/${selBg.id}.jpg)`}: { backgroundImage: 'url(/media/arena.webp)', opacity: 1}} />
{battle.mode!== 'normal' && (<>
<div className="rail left"><div className={`rail-track up ${battle.mode === 'ultimate'? 'slow': ''}`}>{[0, 1].map((h) => (<div key={h} className="rail-half" aria-hidden>{[0, 1, 2].map((i) => (<span key={i} className={`rail-glyph ${battle.mode}`}>{RAIL_LABEL[battle.mode]}</span>))}</div>))}</div></div>
<div className="rail right"><div className={`rail-track down ${battle.mode === 'ultimate'? 'slow': ''}`}>{[0, 1].map((h) => (<div key={h} className="rail-half" aria-hidden>{[0, 1, 2].map((i) => (<span key={i} className={`rail-glyph ${battle.mode}`}>{RAIL_LABEL[battle.mode]}</span>))}</div>))}</div></div>
</>)}
<div className="battle-inner">
<div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap'}}>
<button className="iconbtn" onClick={() => setView('title')}>タイトルへ</button>
<span className={`modechip ${battle.mode}`}>{battle.mode === 'super'? `スーパーモンスタードロー（あと${battle.superLeft}回）`: MODE_LABEL[battle.mode]}</span>
{(battle.mode === 'super') && <span className="note">残り{battle.superLeft}回確定ドロー</span>}
<span style={{ marginLeft: 'auto'}} />
<label className="iconbtn" style={{ cursor: 'pointer'}}>
画像変更
<input type="file" accept="image/*" style={{ display: 'none'}} onChange={async (e) => {
const f = e.target.files?.[0]; if (!f) return;
const url = await downscale(f);
const st = await api.customArt(url); setPlayer(st);
}} />
</label>
{player.customArt && <button className="iconbtn" onClick={async () => { const st = await api.customArt(null); setPlayer(st);}}>画像を戻す</button>}
</div>
<div className="life-row">
<div className={`life ${life <= 0? 'dead': ''}`}>相手 LIFE <b>{life.toLocaleString()}</b></div>
<div className="streak">{battle.streak} 連</div>
</div>
{battle.mode === 'super' && (
<p className="modehint super">{battle.ultraReserved? `ウルトラ昇格確定！ あと ${battle.superLeft} 回引ききるとウルトラへ移行`: `確定ドロー残り ${battle.superLeft} 回 ― この間にウルトラ昇格のチャンス`}</p>
)}
{battle.mode === 'ultra' && (
<p className="modehint ultra">3枚ドローとアルティメット昇格を狙え ― 残念でも通常に戻るだけ</p>
)}
{battle.mode === 'ultimate' && (
<p className="modehint ultimate">最上位モード ― 5枚ドローの大盤振る舞い。残念で通常へ</p>
)}
{notice && <p key={notice.seq} className={`notice ${notice.tone}`}>{notice.text}</p>}
<div className="field">
{battle.lastCards.length === 0 && (
player.customArt? (
<div className="deckcard" style={{ width: 128, height: 180}}><img src={player.customArt} alt="デッキ" style={{ width: '100%', height: '100%', objectFit: 'cover'}} /></div>
): (
<div className="deckcard" style={{ width: 128, height: 180}}><CardBack art={selBack.art} gid={`field-${selBack.id}`} /></div>
)
)}
{battle.lastCards.map((sid, i) => {
const sp = SPECIES_MAP.get(sid)!;
const rar = RARITY_MAP.get(sp.rarity)!;
return (
<div key={`${sid}-${i}`} className="moncard new" style={{ borderColor: rar.frame, boxShadow: `0 0 14px ${rar.glow}`}}>
<div className="art">
<MonsterArt species={sp} />
</div>
<div className="nm">{sp.name}{battle.lastNew[i]? ' ✨NEW': ''}</div>
<div className="atk">攻 {sp.atk} / 守 {sp.def}</div>
</div>
);
})}
</div>
<div className="deckrow">
{player.customArt? (
<div className="deckcard"><img src={player.customArt} alt="デッキ" style={{ width: '100%', height: '100%', objectFit: 'cover'}} /></div>
): (
<div className="deckcard"><CardBack art={selBack.art} gid={`deck-${selBack.id}`} /></div>
)}
<button className="drawbtn" disabled={busy || showIntro || showRevive || showResult} onClick={doDraw}>ドロー！！</button>
</div>
<p className="dmgline">総ダメージ {battle.damage.toLocaleString()} ／ 自己蘇生 残り{2 - battle.revivesUsed}回</p>
</div>
</div>
)}

{view === 'dex' && <DexView player={player} refresh={refresh} setPlayer={setPlayer} />}
{view === 'shop' && <ShopView player={player} refresh={refresh} setPlayer={setPlayer} />}
{view === 'ranking' && <RankingView player={player} />}

{ann && (
<div className="overlay" style={{ pointerEvents: 'none', background: 'transparent'}}>
<div className="announce">
<h3>{ann.title}</h3>
{ann.sub && <p>{ann.sub}</p>}
</div>
</div>
)}
{skit >= 0 && (
<div className="overlay" style={{ pointerEvents: 'none', background: 'rgba(4,6,16,.45)'}}>
<div className="skit">
<div className="who">{skit === 1? '自分': '友達'}</div>
<div className="line">{['もうやめて！！', 'はなせ！！', 'とっくに相手のライフはゼロよ！！'][skit]}</div>
</div>
</div>
)}
{showIntro && (
<div className="overlay">
<div className="announce">
<h3 style={{ fontSize: 20}}>速攻魔法発動！！</h3>
<p>ドローする度にモンスターなら相手に1500ダメージ。外れるまでドローし続けられる。モンスターを引くほど連チャンとソウルが増えていく、捨て身の速攻魔法。</p>
<button className="bigbtn" onClick={() => setShowIntro(false)}>ドローを開始する</button>
</div>
</div>
)}
{showRevive && battle && (
<div className="overlay">
<div className="modal">
<h3>残念…！ でも、まだ終われない</h3>
<p className="note">自己蘇生 {battle.revivesUsed + 1} 回目（最大2回）。連チャンとダメージは継続します。</p>
{battle.revivesUsed === 0? (
<p className="revive-mode normal">通常モードから再開！</p>
): (
<p className="revive-mode ultra">ウルトラモンスターカードドローモードから再開！</p>
)}
{battle.revivesUsed === 0 &&!player.adFree && (
<button className="bigbtn" disabled={player.souls < 100} onClick={() => doRevive('souls')}>100ソウルで自己蘇生（残り {player.souls}）</button>
)}
{player.adFree? (
<button className="bigbtn" onClick={() => doRevive('ad')}>自己蘇生する（広告無期限廃止・適用中）</button>
): (
<button className="bigbtn" onClick={() => setShowAd(true)}>広告を見て自己蘇生</button>
)}
<button className="subbtn" onClick={() => { setShowRevive(false); finishRun();}}>あきらめる</button>
</div>
</div>
)}
{showAd && (
<div className="overlay">
<div className="modal">
<AdPreparing onDone={() => doRevive('ad')} onCancel={() => setShowAd(false)} />
</div>
</div>
)}
{showResult && battle && (
<ResultModal streak={battle.streak} damage={battle.damage} onSubmit={submitAndClose} />
)}
{showFlow && (
<div className="overlay" onClick={() => setShowFlow(false)}>
<div className="modal" onClick={(e) => e.stopPropagation()}>
<h3>ゲームフロー図</h3>
<FlowChart />
<button className="subbtn" onClick={() => setShowFlow(false)}>閉じる</button>
</div>
</div>
)}
</div>
);
}

function downscale(file: File): Promise<string> {
return new Promise((resolve, reject) => {
const img = new Image();
img.onload = () => {
const max = 512;
const scale = Math.min(1, max / Math.max(img.width, img.height));
const canvas = document.createElement('canvas');
canvas.width = Math.round(img.width * scale);
canvas.height = Math.round(img.height * scale);
canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
resolve(canvas.toDataURL('image/jpeg', 0.85));
};
img.onerror = reject;
img.src = URL.createObjectURL(file);
});
}

function AdPreparing({ onDone, onCancel}: { onDone: () => void; onCancel: () => void}) {
const [sec, setSec] = useState(8);
useEffect(() => {
if (sec <= 0) return;
const t = window.setTimeout(() => setSec(sec - 1), 1000);
return () => window.clearTimeout(t);
}, [sec]);
return (
<div>
<div className="adbox">広告は準備中です<br /><span style={{ fontSize: 13, fontWeight: 400}}>広告が始まったら、ここに広告が表示されます。あと少しだけお待ちください。</span></div>
<p className="note" style={{ textAlign: 'center'}}>{sec > 0? `あと ${sec} 秒…`: 'お待たせしました'}</p>
<button className="bigbtn" disabled={sec > 0} onClick={onDone}>自己蘇生する</button>
<button className="subbtn" onClick={onCancel}>やめる</button>
</div>
);
}

function ResultModal({ streak, damage, onSubmit}: { streak: number; damage: number; onSubmit: (name: string) => void}) {
const [name, setName] = useState(() => localStorage.getItem('doro-name') || '');
return (
<div className="overlay">
<div className="modal">
<h3>デュエル終了！</h3>
<p>連チャン：<b>{streak} 連</b></p>
<p>総ダメージ：<b>{damage.toLocaleString()}</b></p>
<p className="note">ランキングに記録する名前を入力してください。</p>
<div className="codebox">
<input value={name} onChange={(e) => setName(e.target.value)} placeholder="名前" maxLength={20} style={{ textTransform: 'none'}} />
</div>
<button className="bigbtn" onClick={() => onSubmit(name.trim() || '名無し')}>記録してタイトルへ</button>
</div>
</div>
);
}

function FlowChart() {
return (
<div className="flow">
<div className="flowbox" style={{ borderColor: '#3e7cb1'}}>
<b style={{ color: '#7db8ec'}}>通常モード</b><br />
モンスター 70% ／ スーパーモード突入 10% ／ 残念（終了）20%
</div>
<div className="flowarrow">▼ スーパー突入 10%</div>
<div className="flowbox" style={{ borderColor: '#9aa3ad'}}>
<b style={{ color: '#e8ecf4'}}>スーパーモンスタードロー</b><br />
3回確定ドロー。各回23.4%でウルトラ昇格を予約（3回引ききってから移行）。消化後は通常へ（連チャン継続）
</div>
<div className="flowarrow">▼ ウルトラ昇格（予約成立時）</div>
<div className="flowbox" style={{ borderColor: '#f0b429'}}>
<b style={{ color: '#ffd94d'}}>ウルトラモンスターカードドロー</b><br />
モンスター 40% ／ 一気に3枚 35% ／ アルティメット昇格 10% ／ 通常へ転落 15%
</div>
<div className="flowarrow">▼ アルティメット昇格 10%</div>
<div className="flowbox" style={{ borderColor: '#ff5fa2', background: 'linear-gradient(180deg,#2c1440,#10142c)'}}>
<b style={{ background: 'linear-gradient(90deg,#ff5f6d,#ffb340,#ffe94d,#7ee081,#4db2ff,#b04fd8)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent'}}>アルティメットドローモード</b><br />
モンスター 30% ／ 一気に5枚 60% ／ 通常へ転落 10%
</div>
<p className="note">モンスター1枚＝1500ダメージ。ドローで連チャンが増える度にソウル+1。残念で終了した時は自己蘇生（最大2回）が使えます。</p>
</div>
);
}

/* ---------------- 図鑑 ---------------- */
function DexView({ player, refresh, setPlayer}: { player: PlayerState; refresh: () => Promise<PlayerState>; setPlayer: (p: PlayerState) => void}) {
const [detail, setDetail] = useState<number | null>(null);
const [confirmSell, setConfirmSell] = useState(false);
const [bulk, setBulk] = useState<{ rarity: string; cards: number; gained: number} | null>(null);
const [msg, setMsg] = useState('');
const order = [...RARITIES].reverse();
const sp = detail!= null? SPECIES_MAP.get(detail)!: null;
const entry = detail!= null? player.collection[detail]: undefined;

return (
<div className="view">
<h2 className="sec">モンスター図鑑（{Object.keys(player.collection).length} / {SPECIES.length}）</h2>
{msg && <p className="msg ok">{msg}</p>}
{order.map((rar) => {
const list = SPECIES.filter((s) => s.rarity === rar.id);
const owned = list.filter((s) => player.collection[s.id]).length;
return (
<div key={rar.id}>
<div className="rarity-head">
<span className="chip" style={{ background: rar.chipBg, border: `1.5px solid ${rar.frame}`}}>{rar.label}</span>
<span className="note">{owned} / {list.length}</span>
{rar.id!== 'UL' && (
<button className="sellall" onClick={async () => {
const pv = await api.sellDuplicatesPreview(rar.id);
if (pv.cards === 0) { setMsg('売れる重複カードがありません'); return;}
setBulk({ rarity: rar.id, cards: pv.cards, gained: pv.gained});
}}>各種1枚残して全て売る</button>
)}
</div>
<div className="dexgrid">
{list.map((s) => {
const e = player.collection[s.id];
return (
<button key={s.id} className="dexcard" style={{ borderColor: rar.frame}} onClick={() => { setDetail(s.id); setConfirmSell(false);}}>
<div className="art"><MonsterArt species={s} silhouette={!e} /></div>
{e && <span className="cnt">×{e.count}</span>}
<div className="nm">No.{s.id} {e? s.name: '？？？'}</div>
</button>
);
})}
</div>
</div>
);
})}

{sp && (
<div className="overlay" onClick={() => setDetail(null)}>
<div className="modal" onClick={(e) => e.stopPropagation()}>
<div className="detail-art" style={{ borderColor: RARITY_MAP.get(sp.rarity)!.frame}}>
<MonsterArt species={sp} silhouette={!entry} />
</div>
<h3 style={{ marginBottom: 4}}>No.{sp.id} {entry? sp.name: '？？？'}</h3>
<div className="stat-row">
<span>{RARITY_MAP.get(sp.rarity)!.label}</span>
<span>攻撃 {entry? sp.atk: '???'}</span>
<span>守備 {entry? sp.def: '???'}</span>
<span>所持数 {entry? entry.count: 0}</span>
{entry?.firstGotAt && <span>初ゲット {new Date(entry.firstGotAt).toLocaleDateString('ja-JP')}</span>}
</div>
<p className="note">{entry? sp.flavor: 'まだ出会っていないモンスター。'}</p>
{entry && sp.sellPrice!= null && (
confirmSell? (
<div>
<p className="msg err">本当に1枚売りますか？（+{sp.sellPrice}ソウル）</p>
<button className="bigbtn" onClick={async () => {
try {
const r = await api.sellCard(sp.id);
setMsg(`売却しました（+${r.gained}ソウル）`);
setConfirmSell(false);
await refresh();
} catch (err) { setMsg((err as Error).message);}
}}>はい、売る</button>
<button className="subbtn" onClick={() => setConfirmSell(false)}>やめる</button>
</div>
): (
<button className="bigbtn" disabled={entry.count <= 1} onClick={() => setConfirmSell(true)}>
{entry.count <= 1? '最後の1枚は売れません': `1枚売る（+${sp.sellPrice}ソウル）`}
</button>
)
)}
{entry && sp.sellPrice == null && <p className="note">このカードは売却できません。</p>}
<button className="subbtn" onClick={() => setDetail(null)}>閉じる</button>
</div>
</div>
)}

{bulk && (
<div className="overlay">
<div className="modal">
<h3>一括売却の確認</h3>
<p>{RARITY_MAP.get(bulk.rarity)!.label}の重複 {bulk.cards} 枚を売って <b>{bulk.gained} ソウル</b> を獲得します。各種1枚は残ります。</p>
<button className="bigbtn" onClick={async () => {
try {
const r = await api.sellDuplicates(bulk.rarity);
setMsg(`一括売却しました（${r.cards}枚 / +${r.gained}ソウル）`);
setBulk(null);
await refresh();
} catch (err) { setMsg((err as Error).message); setBulk(null);}
}}>売る</button>
<button className="subbtn" onClick={() => setBulk(null)}>やめる</button>
</div>
</div>
)}
</div>
);
}

/* ---------------- ショップ ---------------- */
const PACK_INFO = [
{ kind: 'normal', name: 'ノーマルパック', price: 100, desc: 'ランダム3枚。ノーマルからアルティメットレジェンドまで全てのレアリティが出ます。'},
{ kind: 'rare', name: 'レア以上確定パック', price: 300, desc: 'ランダム10枚、全てレア以上。アルティメットレジェンド（0.025%）も出現します。'},
{ kind: 'unowned', name: '未所持確定パック', price: 1000, desc: '未所持のカードが必ず1枚出ます。※アルティメットレジェンドは出現しません。'},
{ kind: 'ultimate', name: 'アルティメットレジェンド確定パック', price: 5000, desc: '虹霓の創世龍レインボー＝オリジンが必ず出ます。カード裏面コンプリートで解放。'},
];

function ShopView({ player, refresh, setPlayer}: { player: PlayerState; refresh: () => Promise<PlayerState>; setPlayer: (p: PlayerState) => void}) {
const [msg, setMsg] = useState<{ ok: boolean; text: string} | null>(null);
const [packResult, setPackResult] = useState<{ speciesId: number; isNew: boolean}[] | null>(null);
const [code, setCode] = useState('');
const allBg = player.ownedBackgrounds.length >= BACKGROUNDS.length;
const allBack = player.ownedCardBacks.length >= CARD_BACKS.length;
const unownedLeft = SPECIES.filter((s) => s.id!== UL_ID &&!player.collection[s.id]).length;

const buy = async (fn: () => Promise<unknown>, okText: string) => {
try { await fn(); setMsg({ ok: true, text: okText}); await refresh();}
catch (e) { setMsg({ ok: false, text: (e as Error).message});}
};

return (
<div className="view">
<h2 className="sec">ショップ（ソウル：{player.souls.toLocaleString()}）</h2>
{msg && <p className={`msg ${msg.ok? 'ok': 'err'}`}>{msg.text}</p>}

<h2 className="sec">カードパック</h2>
{PACK_INFO.map((pk) => {
const lockedUltimate = pk.kind === 'ultimate' &&!allBack;
const impossible = pk.kind === 'unowned' && unownedLeft === 0;
return (
<div key={pk.kind} className="shopitem">
<h4>{pk.name} <span className="price">{pk.price.toLocaleString()}ソウル</span></h4>
<p className="note">{pk.desc}</p>
{lockedUltimate && <p className="msg err">未解放：カード裏面をコンプリートすると買えます</p>}
{impossible && <p className="msg err">未所持はアルティメットレジェンドのみのため購入できません</p>}
<button className="buybtn" disabled={player.souls < pk.price || lockedUltimate || impossible}
onClick={() => buy(async () => {
const r = await api.buyPack(pk.kind);
setPackResult(r.cards.map((c) => ({ speciesId: c.speciesId, isNew: c.isNew})));
}, '')}>購入して開封</button>
</div>
);
})}

<h2 className="sec">対戦背景（各500ソウル）</h2>
<div className="cosgrid">
<button className={`coscard ${player.selectedBg === 'default'? 'sel': ''}`} onClick={() => buy(async () => setPlayer(await api.selectCosmetic('background', 'default')), '標準背景にしました')}>
<div style={{ height: 74, backgroundImage: 'url(/media/arena.webp)', backgroundSize: 'cover', backgroundPosition: 'center'}} />
<div className="cn">標準アリーナ</div><div className="cp">使用中にする</div>
</button>
{BACKGROUNDS.map((bg) => {
const owned = player.ownedBackgrounds.includes(bg.id);
return (
<button key={bg.id} className={`coscard ${player.selectedBg === bg.id? 'sel': ''}`}
onClick={() => owned
? buy(async () => setPlayer(await api.selectCosmetic('background', bg.id)), '背景を変更しました')
: buy(async () => setPlayer(await api.buyCosmetic('background', bg.id)), `「${bg.name}」を購入しました`)}>
<img src={`/media/bg/${bg.id}.jpg`} alt={bg.name} />
<div className="cn">{bg.name}</div>
<div className="cp">{owned? (player.selectedBg === bg.id? '使用中': 'タップで使用'): '500ソウル'}</div>
</button>
);
})}
</div>

<h2 className="sec">カード裏面（各500ソウル）{!allBg && <span className="note"> ※背景コンプリートで解放</span>}</h2>
<div className="cosgrid">
<button className={`coscard ${player.selectedBack === 'default'? 'sel': ''}`} onClick={() => buy(async () => setPlayer(await api.selectCosmetic('cardback', 'default')), '標準の裏面にしました')}>
<div className="backart"><CardBack art={DEFAULT_BACK.art} gid="shop-default" /></div>
<div className="cn">標準（渦巻き）</div><div className="cp">使用中にする</div>
</button>
{CARD_BACKS.map((cb) => {
const owned = player.ownedCardBacks.includes(cb.id);
return (
<button key={cb.id} className={`coscard ${player.selectedBack === cb.id? 'sel': ''}`} disabled={!allBg &&!owned}
onClick={() => owned
? buy(async () => setPlayer(await api.selectCosmetic('cardback', cb.id)), '裏面を変更しました')
: buy(async () => setPlayer(await api.buyCosmetic('cardback', cb.id)), `裏面「${cb.name}」を購入しました`)}>
<div className="backart"><CardBack art={cb.art} gid={`shop-${cb.id}`} /></div>
<div className="cn">{cb.name}</div>
<div className="cp">{!allBg &&!owned? '未解放': owned? (player.selectedBack === cb.id? '使用中': 'タップで使用'): '500ソウル'}</div>
</button>
);
})}
</div>

<h2 className="sec">課金アイテム</h2>
<div className="goldbox"><br />ご購入後、解除コードを購入時のメールアドレス宛に yamamoto510yoh@gmail.com からお送りします。届いたコードを下の「コード入力」に入力すると反映されます。</div>
{PREMIUM.map((it) => {
const owned = it.id === 'ad_free' && player.adFree;
return (
<div key={it.id} className="shopitem">
<h4>{it.name} <span className="price">{it.price}</span></h4>
{it.desc && <p className="note">{it.desc}</p>}
{owned? <p className="msg ok">所有済み（有効になっています）</p>: (
<a className="buybtn" href={stripeUrl(it.url)} target="_blank" rel="noreferrer" style={{ display: 'inline-block', textDecoration: 'none'}}>購入する（Stripe）</a>
)}
</div>
);
})}

<h2 className="sec">コード入力</h2>
<p className="note">コードは購入時のメールアドレス宛に yamamoto510yoh@gmail.com から届きます。</p>
<div className="codebox">
<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="DM-XXXX-XXXX" />
<button className="buybtn" onClick={() => buy(async () => {
const r = await api.redeemCode(code);
setMsg({ ok: true, text: r.message});
setCode('');
}, '')}>入力</button>
</div>

{packResult && (
<div className="overlay" onClick={() => setPackResult(null)}>
<div className="modal" onClick={(e) => e.stopPropagation()}>
<h3>開封結果</h3>
<div className="packresult">
{packResult.map((c, i) => {
const sp = SPECIES_MAP.get(c.speciesId)!;
const rar = RARITY_MAP.get(sp.rarity)!;
return (
<div key={i} className="moncard" style={{ borderColor: rar.frame, boxShadow: `0 0 12px ${rar.glow}`}}>
<div className="art"><MonsterArt species={sp} /></div>
<div className="nm">{sp.name}{c.isNew? ' ✨NEW': ''}</div>
<div className="atk">攻 {sp.atk} / 守 {sp.def}</div>
</div>
);
})}
</div>
<button className="subbtn" onClick={() => setPackResult(null)}>閉じる</button>
</div>
</div>
)}
</div>
);
}

/* ---------------- ランキング ---------------- */
function RankingView({ player}: { player: PlayerState}) {
const [rankings, setRankings] = useState<Rankings | null>(null);
const [tab, setTab] = useState<'streak' | 'souls' | 'completion'>('streak');
useEffect(() => { api.rankings().then(setRankings).catch(() => {});}, []);
if (!rankings) return <div className="view"><p>読み込み中…</p></div>;
const set = rankings[tab];
const ownedCount = Object.keys(player.collection).length;
const valOf = (e: { streak: number; lifetimeSouls: number; compElapsedMs: number | null}) =>
tab === 'streak'? `${e.streak} 連`: tab === 'souls'? `${e.lifetimeSouls.toLocaleString()} ソウル`: e.compElapsedMs!= null? formatElapsed(e.compElapsedMs): '-';
return (
<div className="view">
<h2 className="sec">ランキング</h2>
<div className="ranktabs">
<button className={tab === 'streak'? 'on': ''} onClick={() => setTab('streak')}>連チャン数</button>
<button className={tab === 'souls'? 'on': ''} onClick={() => setTab('souls')}>総ソウル獲得数</button>
<button className={tab === 'completion'? 'on': ''} onClick={() => setTab('completion')}>図鑑コンプ時間</button>
</div>
<table className="rank">
<thead><tr><th>順位</th><th>名前</th><th>記録</th></tr></thead>
<tbody>
{set.top.map((e) => (
<tr key={e.rank} className={e.isMe? 'me': ''}><td>{e.rank}</td><td>{e.name}</td><td>{valOf(e)}</td></tr>
))}
{set.top.length === 0 && <tr><td colSpan={3}>まだ記録がありません</td></tr>}
</tbody>
</table>
<div className="ownbox">
{tab === 'completion' && player.compElapsedMs == null? (
<>あなたの記録：<b>未達成</b>（{ownedCount} / {SPECIES.length}）― 計測中：{formatElapsed(Date.now() - player.createdAt)}</>
): set.own? (
<>あなたの順位：<b>{set.own.rank} 位</b>（{valOf(set.own)}）</>
): (
<>あなたの記録：まだありません（デュエルを終えると記録されます）</>
)}
</div>
</div>
);
}
