const KEY = 'doro-player-id';
export function playerId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(KEY, id);
  }
  return id;
}

export interface CollectionEntry { count: number; firstGotAt: number | null }
export interface PlayerState {
  playerId: string; name: string; souls: number; lifetimeSouls: number;
  adFree: boolean; doubleDraw: boolean; bgmEnabled: boolean; voiceMuted: boolean;
  selectedBg: string; selectedBack: string; customArt: string | null;
  createdAt: number; compElapsedMs: number | null;
  collection: Record<number, CollectionEntry>;
  ownedBackgrounds: string[]; ownedCardBacks: string[];
}

async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: playerId(), ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
  return data as T;
}

export const api = {
  state: () => post<PlayerState>('/api/state'),
  recordDraw: (speciesId: number) => post<{ count: number; isNew: boolean; ownedSpecies: number; compElapsedMs: number | null }>('/api/record-draw', { speciesId }),
  awardSouls: (amount: number) => post<{ souls: number; lifetimeSouls: number }>('/api/award-souls', { amount }),
  payRevive: () => post<{ souls: number }>('/api/pay-revive'),
  sellCard: (speciesId: number) => post<{ souls: number; count: number; gained: number }>('/api/sell-card', { speciesId }),
  sellDuplicates: (rarity: string) => post<{ souls: number; cards: number; gained: number }>('/api/sell-duplicates', { rarity }),
  sellDuplicatesPreview: (rarity: string) => post<{ cards: number; gained: number }>('/api/sell-duplicates-preview', { rarity }),
  buyPack: (kind: string) => post<{ cards: { speciesId: number; count: number; isNew: boolean }[]; souls: number }>('/api/buy-pack', { kind }),
  buyCosmetic: (kind: string, designId: string) => post<PlayerState>('/api/buy-cosmetic', { kind, designId }),
  selectCosmetic: (kind: string, designId: string) => post<PlayerState>('/api/select-cosmetic', { kind, designId }),
  redeemCode: (code: string) => post<{ item: string; message: string; souls: number }>('/api/redeem-code', { code }),
  submitScore: (name: string, streak: number) => post<{ ok: boolean }>('/api/submit-score', { name, streak }),
  rankings: () => post<Rankings>('/api/rankings'),
  settings: (s: { bgmEnabled?: boolean; voiceMuted?: boolean }) => post<PlayerState>('/api/settings', s),
  customArt: (dataUrl: string | null) => post<PlayerState>('/api/custom-art', { dataUrl }),
};

export interface RankEntry { rank: number; name: string; streak: number; lifetimeSouls: number; compElapsedMs: number | null; isMe?: boolean }
export interface RankingSet { top: RankEntry[]; own: RankEntry | null }
export interface Rankings { streak: RankingSet; souls: RankingSet; completion: RankingSet }
