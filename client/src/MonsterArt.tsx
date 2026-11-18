// Deterministic generative monster SVG (species 1-150), reimplemented from the
// catalog art spec: mulberry32 PRNG seeded by species seed; body silhouette by
// body kind; colors body=hsl(hue 55% 46%), belly=hsl(hue 70% 72%),
// accent=hsl((hue+40)%360 80% 58%), dark=hsl(hue 45% 26%), eye=#14100a.
// viewBox 0 0 200 160. Undiscovered copies render as a silhouette palette.
import React from 'react';
import type { Species } from './data';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Palette { body: string; belly: string; accent: string; dark: string; eye: string }
function palette(sp: Species, silhouette: boolean): Palette {
  if (silhouette) return { body: '#23232e', belly: '#2e2e3a', accent: '#1a1a22', dark: '#15151c', eye: '#3d3d4d' };
  const h = sp.hue;
  return {
    body: `hsl(${h} 55% 46%)`,
    belly: `hsl(${h} 70% 72%)`,
    accent: `hsl(${(h + 40) % 360} 80% 58%)`,
    dark: `hsl(${h} 45% 26%)`,
    eye: '#14100a',
  };
}

interface Feats {
  horns: number; // 0 none, 1 small, 2 big
  eyes: number; // 1..3
  wings: boolean;
  spikes: number; // 0..5
  belly: number; // 0 none, 1 plain, 2 stripes, 3 dots
  tail: number; // 0 none, 1 curl, 2 spade
  crest: boolean;
}
function features(seed: number): Feats {
  const r = mulberry32(seed);
  return {
    horns: Math.floor(r() * 3),
    eyes: 1 + Math.floor(r() * 3),
    wings: r() < 0.45,
    spikes: Math.floor(r() * 6),
    belly: Math.floor(r() * 4),
    tail: Math.floor(r() * 3),
    crest: r() < 0.4,
  };
}

function Eyes({ cx, cy, n, gap = 15, r = 4.6, color }: { cx: number; cy: number; n: number; gap?: number; r?: number; color: string }) {
  const offs = n === 1 ? [0] : n === 2 ? [-gap / 2, gap / 2] : [-gap, 0, gap];
  return (<g>{offs.map((o, i) => (
    <g key={i}>
      <circle cx={cx + o} cy={cy} r={r + 1.6} fill="#ffffff" opacity={0.9} />
      <circle cx={cx + o} cy={cy} r={r} fill={color} />
    </g>))}
  </g>);
}
function Horns({ x, y, kind, color, flip = false }: { x: number; y: number; kind: number; color: string; flip?: boolean }) {
  if (kind === 0) return null;
  const s = flip ? -1 : 1;
  const d = kind === 1
    ? `M ${x} ${y} L ${x + 7 * s} ${y - 16} L ${x + 13 * s} ${y + 1} Z`
    : `M ${x} ${y} C ${x + 16 * s} ${y - 20}, ${x + 20 * s} ${y - 8}, ${x + 22 * s} ${y - 26} C ${x + 14 * s} ${y - 12}, ${x + 10 * s} ${y - 6}, ${x + 12 * s} ${y + 2} Z`;
  return <path d={d} fill={color} />;
}
function Spikes({ points, color }: { points: [number, number][]; color: string }) {
  return (<g>{points.map(([x, y], i) => (<path key={i} d={`M ${x - 7} ${y} L ${x} ${y - 15} L ${x + 7} ${y} Z`} fill={color} />))}</g>);
}
function Belly({ cx, cy, rx, ry, kind, color, line }: { cx: number; cy: number; rx: number; ry: number; kind: number; color: string; line: string }) {
  if (kind === 0) return null;
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={color} />
      {kind === 2 && (<g stroke={line} strokeWidth={3} opacity={0.55}>
        <line x1={cx - rx * 0.6} y1={cy - ry * 0.3} x2={cx + rx * 0.6} y2={cy - ry * 0.3} />
        <line x1={cx - rx * 0.7} y1={cy + ry * 0.15} x2={cx + rx * 0.7} y2={cy + ry * 0.15} />
        <line x1={cx - rx * 0.55} y1={cy + ry * 0.55} x2={cx + rx * 0.55} y2={cy + ry * 0.55} />
      </g>)}
      {kind === 3 && (<g fill={line} opacity={0.5}>
        <circle cx={cx - rx * 0.35} cy={cy - ry * 0.2} r={3.4} /><circle cx={cx + rx * 0.3} cy={cy + ry * 0.1} r={3.4} />
        <circle cx={cx} cy={cy + ry * 0.45} r={3} /><circle cx={cx + rx * 0.05} cy={cy - ry * 0.5} r={2.6} />
      </g>)}
    </g>
  );
}
function Wing({ x, y, scale = 1, color }: { x: number; y: number; scale?: number; color: string }) {
  return <path d={`M ${x} ${y} C ${x + 26 * scale} ${y - 30 * scale}, ${x + 44 * scale} ${y - 26 * scale}, ${x + 50 * scale} ${y - 34 * scale} C ${x + 46 * scale} ${y - 12 * scale}, ${x + 40 * scale} ${y - 8 * scale}, ${x + 44 * scale} ${y + 2 * scale} C ${x + 28 * scale} ${y - 2 * scale}, ${x + 14 * scale} ${y + 2 * scale}, ${x} ${y + 4 * scale} Z`} fill={color} opacity={0.92} />;
}

export default function MonsterArt({ species, silhouette = false }: { species: Species; silhouette?: boolean }) {
  const p = palette(species, silhouette);
  const f = features(species.seed);
  const b = species.body;
  let body: React.ReactNode = null;

  if (b === 'blob') {
    body = (<g>
      <path d="M100 16 C138 16 156 62 156 98 C156 128 132 144 100 144 C68 144 44 128 44 98 C44 62 62 16 100 16 Z" fill={p.body} />
      {f.spikes > 0 && <Spikes points={Array.from({ length: f.spikes }, (_, i) => [70 + i * 15, 30 + Math.abs(i - (f.spikes - 1) / 2) * 4] as [number, number])} color={p.accent} />}
      <Belly cx={100} cy={114} rx={33} ry={23} kind={f.belly} color={p.belly} line={p.dark} />
      <Horns x={72} y={30} kind={f.horns} color={p.accent} />
      <Horns x={128} y={30} kind={f.horns} color={p.accent} flip />
      <Eyes cx={100} cy={78} n={f.eyes} color={p.eye} />
      <path d="M88 94 Q100 102 112 94" stroke={p.dark} strokeWidth={3.4} fill="none" strokeLinecap="round" />
    </g>);
  } else if (b === 'beast') {
    body = (<g>
      {f.tail === 1 && <path d="M158 88 C182 80 186 58 172 46" stroke={p.accent} strokeWidth={8} fill="none" strokeLinecap="round" />}
      {f.tail === 2 && <path d="M158 92 C178 88 184 70 180 54 L192 62 L184 74 C186 84 176 96 160 100 Z" fill={p.accent} />}
      <rect x={62} y={112} width={13} height={28} rx={5} fill={p.dark} /><rect x={126} y={112} width={13} height={28} rx={5} fill={p.dark} />
      <rect x={80} y={114} width={13} height={26} rx={5} fill={p.dark} /><rect x={110} y={114} width={13} height={26} rx={5} fill={p.dark} />
      <ellipse cx={104} cy={92} rx={58} ry={33} fill={p.body} />
      {f.spikes > 0 && <Spikes points={Array.from({ length: f.spikes }, (_, i) => [76 + i * 14, 62 + Math.abs(i - (f.spikes - 1) / 2) * 3] as [number, number])} color={p.accent} />}
      <Belly cx={108} cy={104} rx={34} ry={19} kind={f.belly} color={p.belly} line={p.dark} />
      {f.wings && <Wing x={118} y={66} color={p.accent} />}
      <circle cx={50} cy={66} r={23} fill={p.body} />
      <path d="M36 48 L32 28 L48 40 Z" fill={p.body} /><path d="M62 46 L70 28 L76 44 Z" fill={p.body} />
      <Horns x={34} y={50} kind={f.horns} color={p.accent} />
      <ellipse cx={38} cy={76} rx={10} ry={7} fill={p.belly} />
      <Eyes cx={52} cy={62} n={Math.min(f.eyes, 2)} gap={13} r={3.8} color={p.eye} />
    </g>);
  } else if (b === 'bird') {
    body = (<g>
      <path d="M62 84 L30 66 L40 92 L26 96 L46 108 L38 126 L64 112 Z" fill={p.accent} />
      <line x1={88} y1={128} x2={86} y2={146} stroke={p.dark} strokeWidth={4} strokeLinecap="round" />
      <line x1={110} y1={128} x2={112} y2={146} stroke={p.dark} strokeWidth={4} strokeLinecap="round" />
      <ellipse cx={100} cy={94} rx={43} ry={37} fill={p.body} />
      <ellipse cx={92} cy={98} rx={24} ry={26} fill={p.accent} opacity={0.85} transform="rotate(-18 92 98)" />
      <Belly cx={108} cy={108} rx={20} ry={16} kind={f.belly} color={p.belly} line={p.dark} />
      <circle cx={126} cy={50} r={21} fill={p.body} />
      {f.crest && <path d="M118 32 C116 20 124 12 132 10 C128 18 130 24 134 28 C126 28 120 30 118 32 Z" fill={p.accent} />}
      <Horns x={112} y={36} kind={f.horns} color={p.accent} />
      <path d="M144 46 L164 54 L144 62 Z" fill={p.accent} />
      <Eyes cx={128} cy={48} n={Math.min(f.eyes, 2)} gap={11} r={3.4} color={p.eye} />
    </g>);
  } else if (b === 'golem') {
    body = (<g>
      <rect x={38} y={66} width={20} height={52} rx={8} fill={p.dark} transform="rotate(10 48 92)" />
      <rect x={142} y={66} width={20} height={52} rx={8} fill={p.dark} transform="rotate(-10 152 92)" />
      <rect x={66} y={116} width={24} height={26} rx={5} fill={p.dark} /><rect x={110} y={116} width={24} height={26} rx={5} fill={p.dark} />
      <path d="M58 52 L142 52 L150 122 L50 122 Z" fill={p.body} />
      {f.spikes > 0 && <Spikes points={Array.from({ length: f.spikes }, (_, i) => [70 + i * 15, 54] as [number, number])} color={p.accent} />}
      <path d="M66 78 L92 88 L78 100 M126 74 L108 92 L128 106" stroke={p.dark} strokeWidth={3} fill="none" opacity={0.6} />
      <Belly cx={100} cy={104} rx={26} ry={15} kind={f.belly === 0 ? 1 : f.belly} color={p.belly} line={p.dark} />
      <rect x={78} y={22} width={44} height={32} rx={7} fill={p.body} />
      <Horns x={80} y={26} kind={f.horns} color={p.accent} />
      <Horns x={120} y={26} kind={f.horns} color={p.accent} flip />
      <Eyes cx={100} cy={38} n={f.eyes} gap={12} r={3.6} color={p.eye} />
    </g>);
  } else if (b === 'dragon') {
    body = (<g>
      <path d="M150 108 C176 112 186 128 178 142 C160 132 148 126 138 124 Z" fill={p.body} />
      {f.wings && <Wing x={96} y={58} scale={1.15} color={p.accent} />}
      <rect x={66} y={112} width={12} height={26} rx={5} fill={p.dark} /><rect x={118} y={112} width={12} height={26} rx={5} fill={p.dark} />
      <ellipse cx={98} cy={94} rx={56} ry={31} fill={p.body} />
      {f.spikes > 0 && <Spikes points={Array.from({ length: f.spikes }, (_, i) => [66 + i * 15, 66 + Math.abs(i - (f.spikes - 1) / 2) * 3] as [number, number])} color={p.accent} />}
      <Belly cx={100} cy={106} rx={36} ry={17} kind={f.belly} color={p.belly} line={p.dark} />
      <path d="M52 84 C38 74 34 56 44 42 L58 50 C52 60 54 70 62 78 Z" fill={p.body} />
      <path d="M30 44 L58 30 L74 44 L66 60 L38 60 Z" fill={p.body} />
      <path d="M62 44 L84 52 L62 56 Z" fill={p.belly} />
      <Horns x={36} y={36} kind={Math.max(f.horns, 1)} color={p.accent} />
      <Horns x={60} y={30} kind={f.horns} color={p.accent} flip />
      <Eyes cx={48} cy={46} n={Math.min(f.eyes, 2)} gap={11} r={3.4} color={p.eye} />
    </g>);
  } else { // serpent
    body = (<g>
      <path d="M14 128 C50 100 62 142 98 118 C126 100 128 74 152 62" stroke={p.body} strokeWidth={27} fill="none" strokeLinecap="round" />
      <path d="M14 128 C50 100 62 142 98 118 C126 100 128 74 152 62" stroke={p.belly} strokeWidth={9} fill="none" strokeLinecap="round" strokeDasharray="4 14" opacity={0.8} />
      {f.spikes > 0 && <Spikes points={Array.from({ length: f.spikes }, (_, i) => [40 + i * 20, 104 - (i % 3) * 12] as [number, number])} color={p.accent} />}
      {f.wings && <Wing x={128} y={52} scale={0.8} color={p.accent} />}
      <ellipse cx={160} cy={56} rx={19} ry={15} fill={p.body} transform="rotate(-24 160 56)" />
      <path d="M176 62 L190 66 L176 70 Z" fill={p.accent} />
      <path d="M186 68 L196 74 M186 68 L198 64" stroke="#e0483e" strokeWidth={2.4} strokeLinecap="round" />
      <Horns x={148} y={44} kind={f.horns} color={p.accent} />
      <Eyes cx={162} cy={52} n={Math.min(f.eyes, 2)} gap={10} r={3.2} color={p.eye} />
    </g>);
  }

  if (species.id === 151 && !silhouette) {
    return <img src="/media/ultimate.webp" alt={species.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
  }
  return (
    <svg viewBox="0 0 200 160" style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label={silhouette ? '？？？' : species.name}>
      {body}
    </svg>
  );
}
