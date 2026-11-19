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
  adFree: boolean; speedUp: boolean; autoDraw: boolean; fullAuto: boolean; tester: boolean;
  ulSouls: number; drawBonus: number; soulBonus: number;
  speedFast: boolean; playMode: 'manual' | 'auto' | 'fullauto';
  faRevive1: 'souls' | 'ad' | 'end'; faRevive2: 'ad' | 'end';
  bgmEnabled: boolean; voiceMuted: boolean;
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
  recordDraws: (speciesIds: number[]) => post<{ count: number; isNew: boolean }[]>('/api/record-draws', { speciesIds }),
  awardSouls: (amount: number) => post<{ souls: number; lifetimeSouls: number }>('/api/award-souls', { amount }),
  payRevive: () => post<{ souls: number }>('/api/pay-revive'),
  sellCard: (speciesId: number) => post<{ souls: number; count: number; gained: number }>('/api/sell-card', { speciesId }),
  sellDuplicates: (rarity: string) => post<{ souls: number; cards: number; gained: number }>('/api/sell-duplicates', { rarity }),
  sellDuplicatesPreview: (rarity: string) => post<{ cards: number; gained: number }>('/api/sell-duplicates-preview', { rarity }),
  buyPack: (kind: string) => post<{ cards: { speciesId: number; count: number; isNew: boolean }[]; souls: number }>('/api/buy-pack', { kind }),
  buyCosmetic: (kind: string, designId: string) => post<PlayerState>('/api/buy-cosmetic', { kind, designId }),
  selectCosmetic: (kind: string, designId: string) => post<PlayerState>('/api/select-cosmetic', { kind, designId }),
  redeemCode: (code: string) => post<{ item: string; message: string; souls: number }>('/api/redeem-code', { code }),
  sendInquiry: (category: string, body: string, email: string) => post<{ ok: boolean; message: string }>('/api/inquiries', { category, body, email }),
  submitScore: (name: string, streak: number) => post<{ ok: boolean }>('/api/submit-score', { name, streak }),
  rankings: () => post<Rankings>('/api/rankings'),
  settings: (s: { bgmEnabled?: boolean; voiceMuted?: boolean; speedFast?: boolean; playMode?: string; faRevive1?: string; faRevive2?: string }) => post<PlayerState>('/api/settings', s),
  customArt: (dataUrl: string | null) => post<PlayerState>('/api/custom-art', { dataUrl }),
  exchangeUl: () => post<{ ulSouls: number; count: number }>('/api/exchange-ul'),
  buyUlUpgrade: (kind: 'draw' | 'soul') => post<{ ulSouls: number; drawBonus: number; soulBonus: number }>('/api/buy-ul-upgrade', { kind }),
  applyUlMonster: (name: string, description: string) => post<{ ok: boolean; ulSouls: number }>('/api/apply-ul-monster', { name, description }),
  announcements: () => post<{ announcements: Announcement[] }>('/api/announcements'),
  announcementRead: (announcementId: number) => post<{ ok: boolean }>('/api/announcements/read', { announcementId }),
  announcementClaim: (announcementId: number) => post<{ ok: boolean; message: string }>('/api/announcements/claim', { announcementId }),
};

export interface Announcement {
  id: number; title: string; body: string;
  attachType: string; attachAmount: number;
  createdAt: number; expiresAt: number | null;
  read: boolean; claimed: boolean;
}

export interface RankEntry { rank: number; name: string; streak: number; lifetimeSouls: number; compElapsedMs: number | null; isMe?: boolean }
export interface RankingSet { top: RankEntry[]; own: RankEntry | null }
export interface Rankings { streak: RankingSet; souls: RankingSet; completion: RankingSet }
