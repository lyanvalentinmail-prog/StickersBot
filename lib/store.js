// lib/store.js — Sesiones temporales (paquetes en creación y búsquedas de Stickerly)
export const packSessions = new Map(); // clave chat|sender → { name, author, audio, items, createdAt }
export const searchSessions = new Map(); // clave chat|sender → { type, items, createdAt }

export const sessionKey = (chat, sender) => `${chat}|${sender}`;

const TTL_PACK = 10 * 60 * 1000;
const TTL_SEARCH = 5 * 60 * 1000;

export function getPackSession(chat, sender) {
  const key = sessionKey(chat, sender);
  const s = packSessions.get(key);
  if (!s) return null;
  if (Date.now() - s.createdAt > TTL_PACK) {
    packSessions.delete(key);
    return null;
  }
  return s;
}

export function getSearchSession(chat, sender) {
  const key = sessionKey(chat, sender);
  const s = searchSessions.get(key);
  if (!s) return null;
  if (Date.now() - s.createdAt > TTL_SEARCH) {
    searchSessions.delete(key);
    return null;
  }
  return s;
}
