// lib/stickerly.js — Búsqueda de paquetes y stickers en Stickerly (API de la app)
import config from '../config.js';

const SEARCH_URL = 'https://api.sticker.ly/v4/stickerPack/smartSearch';

/** Busca paquetes de stickers en Stickerly. */
export async function searchPacks(keyword) {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'User-Agent': config.stickerlyUA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      keyword,
      enabledKeywordSearch: true,
      filter: {
        extendSearchResult: false,
        sortBy: 'RECOMMENDED',
        languages: ['ALL'],
        minStickerCount: 3,
        searchBy: 'ALL',
        stickerType: 'ALL',
      },
    }),
  });
  if (!res.ok) throw new Error(`Stickerly respondió ${res.status}`);
  const data = await res.json();
  const packs = data?.result?.stickerPacks || data?.stickerPacks || data?.data || [];
  return (Array.isArray(packs) ? packs : []).map((v) => ({
    id: v.packId,
    name: v.name || 'Sin nombre',
    author: v.authorName || 'Desconocido',
    count: v.resourceFiles?.length || 0,
    animated: !!v.isAnimated,
    prefix: v.resourceUrlPrefix || '',
    files: v.resourceFiles || [],
    url: v.shareUrl || `https://sticker.ly/s/${v.packId}`,
  }));
}

/** Descarga un sticker de Stickerly (webp). */
export async function downloadSticker(url) {
  const res = await fetch(url, { headers: { 'User-Agent': config.stickerlyUA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
