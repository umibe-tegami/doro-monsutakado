import catalogJson from '../../data/catalog.json';
import designsJson from '../../data/designs.json';

export interface Rarity { id: string; label: string; short: string; sellPrice: number | null; weight: number; speciesCount: number; frame: string; chipBg: string; glow: string }
export interface Species { id: number; name: string; rarity: string; atk: number; def: number; flavor: string; sellPrice: number | null; seed: number; body: string; hue: number }
export interface BgDesign { id: string; name: string; note: string; price: number; imageFile: string }
export interface BackArt { frame: string; motif: string; motifColor: string; ringA: string; ringB: string; spiral: string; stops: string[] }
export interface BackDesign { id: string; name: string; note: string; price: number; art: BackArt }

export const RARITIES = catalogJson.rarities as unknown as Rarity[];
export const SPECIES = catalogJson.species as unknown as Species[];
export const RARITY_MAP = new Map(RARITIES.map((r) => [r.id, r]));
export const SPECIES_MAP = new Map(SPECIES.map((s) => [s.id, s]));
export const BY_RARITY: Record<string, Species[]> = {};
for (const s of SPECIES) (BY_RARITY[s.rarity] ||= []).push(s);
export const UL_ID = SPECIES.find((s) => s.rarity === 'UL')!.id;

export const BACKGROUNDS = (designsJson as { backgrounds: BgDesign[] }).backgrounds;
export const CARD_BACKS = (designsJson as { cardBacks: BackDesign[] }).cardBacks;
export const DEFAULT_BACK = (designsJson as { defaultCardBack: BackDesign }).defaultCardBack;

// Client-side species draw, mirroring the server table: UL 0.025% pre-roll,
// then weighted rarity (weights from catalog), uniform species in the rarity.
export function drawSpeciesId(): number {
  if (Math.random() * 100 < 0.025) return UL_ID;
  const table = RARITIES.filter((r) => r.id !== 'UL');
  const total = table.reduce((a, r) => a + r.weight, 0);
  let x = Math.random() * total;
  let rid = table[table.length - 1].id;
  for (const r of table) { x -= r.weight; if (x <= 0) { rid = r.id; break; } }
  const pool = BY_RARITY[rid];
  return pool[Math.floor(Math.random() * pool.length)].id;
}

export function formatElapsed(ms: number): string {
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return `${d}日${h}時間${m}分`;
}
