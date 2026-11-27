// lib/brat.js — Stickers brat y brat video (api.delirius.online + respaldos)
import config from '../config.js';

async function fetchFirst(urls, acceptPrefix) {
  let ultimoError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.startsWith(acceptPrefix)) {
        ultimoError = new Error(`HTTP ${res.status} (${ct || 'sin tipo'})`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 1000) return buf;
      ultimoError = new Error('Respuesta vacía');
    } catch (e) {
      ultimoError = e;
    }
  }
  throw ultimoError || new Error('Ninguna API respondió');
}

/** Imagen brat (PNG) a partir de un texto. */
export const fetchBrat = (text) =>
  fetchFirst(config.apis.brat.map((u) => u + encodeURIComponent(text)), 'image/');

/** Video brat (MP4) a partir de un texto. */
export const fetchBratVideo = (text) =>
  fetchFirst(config.apis.bratv.map((u) => u + encodeURIComponent(text)), 'video/');
