// Deterministic generative monster art — faithful port of the original
// (honke) MonsterArt.tsx, using the exported drawing spec verbatim:
// mulberry32 PRNG seeded by species seed picks horns / horn size / eyes /
// wings / spikes / belly dots / tail curl in exactly the original order
// (including the dragon/bird short-circuit that skips the wings roll),
// one shared layout with per-body-kind silhouettes, viewBox 0 0 200 160.
// Species colors: body=hsl(hue 55% 46%), belly=hsl(hue 70% 72%),
// accent=hsl((hue+40)%360 80% 58%), dark=hsl(hue 45% 26%), eye=#14100a.
// The Ultimate Legend (No.151) alone uses the portrait image; undiscovered
// copies of every species render as the silhouette palette.
import React from 'react';
import type { Species } from './data';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function MonsterArt({ species, silhouette = false }: { species: Species; silhouette?: boolean }) {
  // Ultimate Legend (No.151): the portrait is a tall 1:2 image, so it is
  // shown whole (contain) over a blurred copy of itself that fills the
  // frame — cover-cropping it cut off the horns and lower body.
  if (species.id === 151 && !silhouette) {
    return (
      <div className="ultimate-art">
        <img className="ultimate-art-bg" src="/media/ultimate.webp" alt="" aria-hidden draggable={false} />
        <img className="ultimate-art-fg" src="/media/ultimate.webp" alt={species.name} draggable={false} />
      </div>
    );
  }
  const rnd = mulberry32(species.seed);
  const hue = species.hue;
  const body = silhouette ? '#23232e' : `hsl(${hue} 55% 46%)`;
  const belly = silhouette ? '#2e2e3a' : `hsl(${hue} 70% 72%)`;
  const accent = silhouette ? '#1a1a22' : `hsl(${(hue + 40) % 360} 80% 58%)`;
  const dark = silhouette ? '#15151c' : `hsl(${hue} 45% 26%)`;
  const eye = silhouette ? '#3d3d4d' : '#14100a';

  const horns = Math.floor(rnd() * 3); // 0..2 horn pairs style
  const hornSize = 10 + rnd() * 14;
  const eyes = rnd() > 0.75 ? 3 : 2;
  const wings = species.body === 'dragon' || species.body === 'bird' || rnd() > 0.72;
  const spikes = Math.floor(rnd() * 4);
  const bellyDots = rnd() > 0.5;
  const tailCurl = rnd() > 0.5;

  const spikePts: string[] = [];
  for (let i = 0; i < spikes; i++) {
    const x = 78 + i * 15 - spikes * 7;
    spikePts.push(`M ${x} 38 L ${x + 6} ${22 - (i % 2) * 4} L ${x + 12} 38 Z`);
  }

  return (
    <svg
      viewBox="0 0 200 160"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label={silhouette ? '未発見のモンスター' : species.name}
    >
      {/* wings behind body */}
      {wings && (
        <g fill={dark} opacity={0.9}>
          <path d="M52 74 C20 58 10 30 14 12 C34 22 52 40 58 60 Z" />
          <path d="M148 74 C180 58 190 30 186 12 C166 22 148 40 142 60 Z" />
        </g>
      )}
      {/* tail */}
      {species.body === 'serpent' || species.body === 'dragon' ? (
        <path
          d={tailCurl ? 'M150 118 C182 118 188 92 172 82' : 'M150 116 C176 112 186 124 192 138'}
          fill="none"
          stroke={body}
          strokeWidth={11}
          strokeLinecap="round"
        />
      ) : species.body === 'beast' ? (
        <path d="M148 108 C172 100 178 82 170 68" fill="none" stroke={body} strokeWidth={9} strokeLinecap="round" />
      ) : null}
      {/* ears / horns */}
      {species.body === 'beast' && (
        <g fill={body}>
          <path d="M62 44 L54 14 L84 30 Z" />
          <path d="M138 44 L146 14 L116 30 Z" />
        </g>
      )}
      {horns > 0 && species.body !== 'beast' && (
        <g fill={accent}>
          <path d={`M66 36 C60 ${36 - hornSize} 56 ${30 - hornSize} 50 ${26 - hornSize} C60 28 68 30 74 34 Z`} />
          <path d={`M134 36 C140 ${36 - hornSize} 144 ${30 - hornSize} 150 ${26 - hornSize} C140 28 132 30 126 34 Z`} />
          {horns === 2 && <path d="M100 26 C96 14 98 8 100 2 C102 8 104 14 100 26 Z" />}
        </g>
      )}
      {/* back spikes */}
      <g fill={accent}>{spikePts.map((d, i) => <path key={i} d={d} />)}</g>
      {/* body */}
      {species.body === 'blob' ? (
        <path d="M100 26 C138 26 156 62 156 96 C156 124 132 138 100 138 C68 138 44 124 44 96 C44 62 62 26 100 26 Z" fill={body} />
      ) : species.body === 'golem' ? (
        <path d="M58 44 L142 44 L152 132 L48 132 Z" fill={body} />
      ) : species.body === 'serpent' ? (
        <path d="M100 22 C126 22 140 42 138 64 C150 78 148 104 132 118 C112 136 76 136 60 118 C46 102 48 76 64 62 C62 40 76 22 100 22 Z" fill={body} />
      ) : (
        <ellipse cx={100} cy={88} rx={56} ry={52} fill={body} />
      )}
      {/* head plate for golem */}
      {species.body === 'golem' && <rect x={64} y={30} width={72} height={26} rx={8} fill={dark} />}
      {/* belly */}
      <ellipse cx={100} cy={112} rx={30} ry={22} fill={belly} opacity={0.85} />
      {bellyDots && !silhouette && (
        <g fill={accent} opacity={0.7}>
          <circle cx={88} cy={106} r={3.4} />
          <circle cx={104} cy={116} r={3} />
          <circle cx={110} cy={102} r={2.6} />
        </g>
      )}
      {/* eyes */}
      {eyes === 3 ? (
        <g fill={eye}>
          <circle cx={78} cy={76} r={6} />
          <circle cx={122} cy={76} r={6} />
          <circle cx={100} cy={60} r={5} />
        </g>
      ) : (
        <g fill={eye}>
          <circle cx={80} cy={74} r={6.5} />
          <circle cx={120} cy={74} r={6.5} />
        </g>
      )}
      {!silhouette && (
        <g fill="#ffffff" opacity={0.85}>
          <circle cx={82.5} cy={71.5} r={2.2} />
          <circle cx={122.5} cy={71.5} r={2.2} />
        </g>
      )}
      {/* mouth */}
      {species.body === 'dragon' || species.body === 'beast' ? (
        <g>
          <path d="M86 94 Q100 102 114 94" fill="none" stroke={eye} strokeWidth={3.4} strokeLinecap="round" />
          {!silhouette && (
            <g fill="#ffffff">
              <path d="M90 96 L94 96 L92 102 Z" />
              <path d="M106 96 L110 96 L108 102 Z" />
            </g>
          )}
        </g>
      ) : (
        <path d="M90 92 Q100 99 110 92" fill="none" stroke={eye} strokeWidth={3.4} strokeLinecap="round" />
      )}
      {/* feet */}
      <g fill={dark}>
        <ellipse cx={72} cy={140} rx={14} ry={6} />
        <ellipse cx={128} cy={140} rx={14} ry={6} />
      </g>
    </svg>
  );
}
