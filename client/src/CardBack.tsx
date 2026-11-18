// Card back SVG per designs.json spec: viewBox 0 0 200 280, radialGradient
// stops + frame rects + 5 concentric vortex rings (R [88,74,60,46,32],
// alternating ringA/ringB) + spiral path + central motif.
import React from 'react';
import type { BackArt } from './data';

const RINGS = [88, 74, 60, 46, 32];

function spiralPath(cx: number, cy: number, turns = 4.6, maxR = 84): string {
  const steps = 90;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * Math.PI * 2;
    const r = (t / (turns * Math.PI * 2)) * maxR;
    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
  }
  return d;
}

function Motif({ kind, color }: { kind: string; color: string }) {
  const c = color || '#ffffff';
  switch (kind) {
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 25 : 10.5;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
      }
      return <polygon points={pts.join(' ')} fill={c} />;
    }
    case 'flame': return <path d="M0 26 C-14 12 -10 -2 -4 -12 C-2 -6 2 -4 4 -10 C12 2 16 12 0 26 Z M0 26 C-6 18 -4 10 0 4 C4 10 6 18 0 26 Z" fill={c} transform="scale(1.15)" />;
    case 'snow': return (<g stroke={c} strokeWidth={3.4} strokeLinecap="round">
      {[0, 60, 120].map((a) => (<g key={a} transform={`rotate(${a})`}><line x1={-22} y1={0} x2={22} y2={0} /><path d="M14 -6 L22 0 L14 6 M-14 -6 L-22 0 L-14 6" fill="none" /></g>))}
    </g>);
    case 'bolt': return <polygon points="4,-26 -12,4 -2,4 -6,26 14,-6 3,-6" fill={c} />;
    case 'petal': return (<g fill={c}>{[0, 72, 144, 216, 288].map((a) => (<ellipse key={a} cx={0} cy={-13} rx={6.4} ry={13} transform={`rotate(${a})`} />))}<circle r={4.6} fill="#ffffff" /></g>);
    case 'wave': return (<g stroke={c} strokeWidth={4} fill="none" strokeLinecap="round"><path d="M-24 -6 Q-12 -18 0 -6 T24 -6" /><path d="M-24 8 Q-12 -4 0 8 T24 8" /></g>);
    case 'leaf': return (<g><path d="M0 -24 C14 -10 14 10 0 24 C-14 10 -14 -10 0 -24 Z" fill={c} /><path d="M0 -18 L0 20" stroke="#00000055" strokeWidth={2.4} /></g>);
    case 'moon': return <path d="M14 -22 A25 25 0 1 0 14 22 A19 19 0 1 1 14 -22 Z" fill={c} />;
    case 'sun': return (<g fill={c}><circle r={11} />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (<polygon key={a} points="0,-26 -4.6,-13 4.6,-13" transform={`rotate(${a})`} />))}</g>);
    case 'gem': return (<g><polygon points="0,-22 16,-6 0,24 -16,-6" fill={c} /><polygon points="-16,-6 16,-6 8,-20 -8,-20" fill="#ffffff" opacity={0.55} /></g>);
    case 'bubble': return (<g stroke={c} strokeWidth={3.2} fill="none"><circle cx={-6} cy={4} r={13} /><circle cx={11} cy={-10} r={8.4} /><circle cx={12} cy={13} r={5.6} /></g>);
    case 'rainbow': return (<g fill="none" strokeWidth={4.6}>{['#ff5f6d', '#ffb340', '#ffe94d', '#7ee081', '#4db2ff'].map((col, i) => (<path key={col} d={`M ${-22 + i * 2.4} 12 A ${22 - i * 2.4} ${22 - i * 2.4} 0 0 1 ${22 - i * 2.4} 12`} stroke={col} />))}</g>);
    default: return null;
  }
}

export default function CardBack({ art, gid }: { art: BackArt; gid: string }) {
  const stops = art.stops;
  const offsets = stops.length === 4 ? ['0%', '38%', '72%', '100%'] : ['0%', '55%', '100%'];
  return (
    <svg viewBox="0 0 200 280" style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label="カード裏面">
      <defs>
        <radialGradient id={`cb-${gid}`} cx="50%" cy="46%" r="75%">
          {stops.map((s, i) => (<stop key={i} offset={offsets[i] || '100%'} stopColor={s} />))}
        </radialGradient>
      </defs>
      <rect x={2} y={2} width={196} height={276} rx={14} fill={`url(#cb-${gid})`} />
      <rect x={7} y={7} width={186} height={266} rx={11} fill="none" stroke={art.frame} strokeWidth={3} />
      <rect x={14} y={14} width={172} height={252} rx={8} fill="none" stroke={art.frame} strokeWidth={1.4} opacity={0.65} />
      <g transform="translate(0 0)">
        {RINGS.map((r, i) => (
          <ellipse key={r} cx={100} cy={140} rx={r} ry={r * 1.28} fill="none" stroke={i % 2 === 0 ? art.ringA : art.ringB} strokeWidth={5.4} opacity={0.85} />
        ))}
      </g>
      <path d={spiralPath(100, 140)} fill="none" stroke={art.spiral} strokeWidth={2.4} opacity={0.8} transform="translate(0 0) scale(1 1.28) translate(0 -30.8)" />
      <g transform="translate(100 140)"><Motif kind={art.motif} color={art.motifColor} /></g>
    </svg>
  );
}
