// commands/stickers.js — Comandos de stickers (.s, .s2, .newpack, .pack, .searchpack, .searchs, .brat, .bratv)
import config from '../config.js';
import { mediaToSticker, extractAudio, addStickerExif } from '../lib/sticker.js';
import { getMessageMedia, downloadTikTok, downloadUrl, isTikTokUrl, isUrl } from '../lib/media.js';
import { searchPacks, downloadSticker } from '../lib/stickerly.js';
import { fetchBrat, fetchBratVideo } from '../lib/brat.js';
import { packSessions, searchSessions, sessionKey, getPackSession, getSearchSession } from '../lib/store.js';

const P = config.prefijo;
const MAX_PACK = config.sticker.maxPack;

const chatOf = (msg) => msg.key.remoteJid;
const senderOf = (msg) => msg.key.participant || msg.key.remoteJid;

async function reply(sock, msg, text) {
  await sock.sendMessage(chatOf(msg), { text }, { quoted: msg });
}

async function react(sock, msg, emoji) {
  await sock.sendMessage(chatOf(msg), { react: { text: emoji, key: msg.key } }).catch(() => {});
}

/** Envía un sticker con el nombre/autor del paquete en el EXIF. */
async function sendSticker(sock, msg, webp, packname = config.packname, author = config.autor) {
  const conExif = addStickerExif(webp, packname, author);
  await sock.sendMessage(chatOf(msg), { sticker: conExif }, { quoted: msg });
}

/** Envía un paquete: cada sticker lleva el nombre/autor del paquete en el EXIF. */
async function sendPack(sock, msg, { name, publisher, stickers }) {
  let enviados = 0;
  for (const webp of stickers) {
    try {
      await sendSticker(sock, msg, webp, name, publisher);
      enviados++;
    } catch (e) {
      console.error('[pack] sticker:', e.message);
    }
  }
  return enviados;
}

/** Obtiene el buffer a convertir: link (TikTok/directo) o media del mensaje. */
async function getSourceBuffer(sock, msg, args) {
  const arg = (args || []).join(' ').trim();
  if (arg && isUrl(arg)) {
    if (isTikTokUrl(arg)) return { buffer: await downloadTikTok(arg), fromLink: true };
    return { buffer: await downloadUrl(arg), fromLink: true };
  }
  const media = await getMessageMedia(sock, msg);
  if (!media) return null;
  return media;
}

// ── .s ──────────────────────────────────────────────────────────────
export async function s(sock, msg, args) {
  await react(sock, msg, '⏳');
  let src;
  try {
    src = await getSourceBuffer(sock, msg, args);
  } catch (e) {
    return reply(sock, msg, `❌ No se pudo descargar el enlace: ${e.message}`);
  }
  if (!src) {
    return reply(
      sock,
      msg,
      `📌 Responde a una *foto* o *video*, o pega un enlace de TikTok.\n\nEjemplo:\n${P}s https://vm.tiktok.com/XXXX`
    );
  }
  try {
    const webp = await mediaToSticker(src.buffer);
    await sendSticker(sock, msg, webp);
    await react(sock, msg, '✅');
  } catch (e) {
    console.error('[s]', e);
    await reply(sock, msg, `❌ Error al crear el sticker: ${e.message}`);
  }
}

// ── .s2 (sticker con audio) ─────────────────────────────────────────
export async function s2(sock, msg, args) {
  await react(sock, msg, '⏳');
  let src;
  try {
    src = await getSourceBuffer(sock, msg, args);
  } catch (e) {
    return reply(sock, msg, `❌ No se pudo descargar el enlace: ${e.message}`);
  }
  if (!src) {
    return reply(
      sock,
      msg,
      `📌 Responde a un *video* o pega un enlace de TikTok para el sticker con audio.\n\nEjemplo:\n${P}s2 https://vm.tiktok.com/XXXX`
    );
  }
  try {
    const webp = await mediaToSticker(src.buffer, { forzarTipo: 'video' });
    await sendSticker(sock, msg, webp);
    // WhatsApp no permite audio dentro del sticker: se manda como nota de voz.
    try {
      const audio = await extractAudio(src.buffer);
      await sock.sendMessage(chatOf(msg), { audio, ptt: true, mimetype: 'audio/ogg; codecs=opus' });
    } catch (e) {
      console.error('[s2] audio:', e.message);
      await reply(sock, msg, '⚠️ Sticker listo, pero el video no tenía audio.');
    }
    await react(sock, msg, '✅');
  } catch (e) {
    console.error('[s2]', e);
    await reply(sock, msg, `❌ Error al crear el sticker: ${e.message}`);
  }
}

// ── .newpack / .pack ────────────────────────────────────────────────
export async function newpack(sock, msg, args) {
  const partes = (args || []).join(' ').trim().split(/\s+/).filter(Boolean);
  const conAudio = partes[partes.length - 1]?.toLowerCase() === 'audio';
  if (conAudio) partes.pop();
  const nombreAutor = partes.join(' ');
  const idx = nombreAutor.lastIndexOf('.');
  if (idx <= 0 || idx === nombreAutor.length - 1) {
    return reply(
      sock,
      msg,
      `📌 Uso: ${P}newpack nombre.autor\nEjemplo: ${P}newpack Mi Pack.Juan\n\nOpcional: ${P}newpack nombre.autor audio (para incluir el audio)`
    );
  }
  const name = nombreAutor.slice(0, idx).trim();
  const author = nombreAutor.slice(idx + 1).trim();
  if (!name || !author) return reply(sock, msg, '❌ El formato es: nombre.autor (ej: Mi Pack.Juan)');

  packSessions.set(sessionKey(chatOf(msg), senderOf(msg)), {
    name,
    author,
    audio: conAudio,
    items: [],
    createdAt: Date.now(),
  });

  await reply(
    sock,
    msg,
    `📦 *Paquete creado: ${name}*\n👤 Autor: ${author}\n🎵 Audio: ${
      conAudio ? 'activado ✅' : `desactivado (usa ${P}pack audio para activarlo)`
    }\n\n🎨 Ahora envía las fotos/videos que quieras agregar (de a 1 o varias).\n✅ Cuando termines: ${P}pack done\n❌ Para cancelar: ${P}pack cancel`
  );
}

/** Agrega una foto/video al paquete en creación. Devuelve true si lo agregó. */
export async function tryAddToPack(sock, msg) {
  const pack = getPackSession(chatOf(msg), senderOf(msg));
  if (!pack) return false;
  let media = null;
  try {
    media = await getMessageMedia(sock, msg);
  } catch (e) {
    console.error('[pack] descarga:', e.message);
    return true; // era media pero falló la descarga: no seguir como comando
  }
  if (!media) return false;
  if (pack.items.length >= MAX_PACK) {
    await reply(sock, msg, `⚠️ El paquete ya tiene ${MAX_PACK} stickers (máximo). Usa ${P}pack done para enviarlo.`);
    return true;
  }
  pack.items.push(media);
  await reply(sock, msg, `✅ Agregado (${pack.items.length}/${MAX_PACK})`);
  return true;
}

export async function pack(sock, msg, args) {
  const sub = (args?.[0] || '').toLowerCase();
  const key = sessionKey(chatOf(msg), senderOf(msg));
  const pack = getPackSession(chatOf(msg), senderOf(msg));

  if (sub === 'cancel') {
    if (!pack) return reply(sock, msg, '❌ No tienes un paquete en creación.');
    packSessions.delete(key);
    return reply(sock, msg, '🗑️ Paquete cancelado.');
  }
  if (sub === 'audio') {
    if (!pack) return reply(sock, msg, `❌ No tienes un paquete en creación. Usa ${P}newpack primero.`);
    pack.audio = !pack.audio;
    return reply(sock, msg, `🎵 Audio del paquete: ${pack.audio ? 'activado ✅' : 'desactivado ❌'}`);
  }
  if (sub === 'done') {
    if (!pack) return reply(sock, msg, `❌ No tienes un paquete en creación. Usa ${P}newpack nombre.autor primero.`);
    if (!pack.items.length)
      return reply(sock, msg, `⚠️ Aún no agregaste fotos/videos. Envíalas primero o usa ${P}pack cancel.`);
    await react(sock, msg, '⏳');
    packSessions.delete(key);
    try {
      const stickers = [];
      for (const item of pack.items) stickers.push(await mediaToSticker(item.buffer));
      const enviados = await sendPack(sock, msg, {
        name: pack.name,
        publisher: pack.author,
        stickers,
      });
      if (pack.audio) {
        for (const item of pack.items.filter((i) => i.type === 'video')) {
          try {
            const audio = await extractAudio(item.buffer);
            await sock.sendMessage(chatOf(msg), { audio, ptt: true, mimetype: 'audio/ogg; codecs=opus' });
          } catch {
            /* sin audio */
          }
        }
      }
      await reply(sock, msg, `📦 *${pack.name}* enviado (${enviados}/${stickers.length} stickers)`);
      await react(sock, msg, '✅');
    } catch (e) {
      console.error('[pack done]', e);
      await reply(sock, msg, `❌ Error al enviar el paquete: ${e.message}`);
    }
    return;
  }
  return reply(
    sock,
    msg,
    `📌 Uso:\n${P}pack done — enviar el paquete\n${P}pack cancel — cancelar\n${P}pack audio — activar/desactivar audio`
  );
}

// ── .searchpack / .searchs ──────────────────────────────────────────
async function doSearch(sock, msg, args, type) {
  const q = (args || []).join(' ').trim();
  const cmd = type === 'pack' ? 'searchpack' : 'searchs';
  if (!q) {
    return reply(sock, msg, `🔍 Uso: ${P}${cmd} <texto>\nEjemplo: ${P}${cmd} patrick`);
  }
  await react(sock, msg, '⏳');
  let packs;
  try {
    packs = await searchPacks(q);
  } catch (e) {
    return reply(sock, msg, `❌ Error al buscar en Stickerly: ${e.message}`);
  }
  const items = packs.filter((p) => p.prefix && p.files.length).slice(0, 10);
  if (!items.length) return reply(sock, msg, `❌ No encontré resultados para "${q}". Prueba con otra palabra.`);
  searchSessions.set(sessionKey(chatOf(msg), senderOf(msg)), { type, items, createdAt: Date.now() });
  const lista = items.map((p, i) => `${i + 1}. ${p.name} · ${p.count} stickers · ${p.author}`).join('\n');
  await reply(
    sock,
    msg,
    `🎨 *Stickerly · ${q}*\n\n${lista}\n\n👉 Responde con un *número* (1-${items.length}) para ${
      type === 'pack' ? 'enviar el paquete' : 'ver los stickers'
    }.`
  );
}

export const searchpack = (sock, msg, args) => doSearch(sock, msg, args, 'pack');
export const searchs = (sock, msg, args) => doSearch(sock, msg, args, 'stickers');

/** Maneja la respuesta con un número tras .searchpack/.searchs. */
export async function tryHandleSearchPick(sock, msg, text) {
  const s = getSearchSession(chatOf(msg), senderOf(msg));
  if (!s) return false;
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return false;
  const n = parseInt(t, 10);
  if (n < 1 || n > s.items.length) return false;
  searchSessions.delete(sessionKey(chatOf(msg), senderOf(msg)));
  const pick = s.items[n - 1];
  await react(sock, msg, '⏳');
  try {
    if (s.type === 'pack') {
      const stickers = [];
      for (const f of pick.files.slice(0, MAX_PACK)) {
        try {
          const buf = await downloadSticker(pick.prefix + f);
          stickers.push(buf.toString('ascii', 0, 4) === 'RIFF' ? buf : await mediaToSticker(buf));
        } catch (e) {
          console.error('[searchpack] sticker:', e.message);
        }
      }
      if (!stickers.length) return reply(sock, msg, '❌ No se pudieron descargar los stickers del paquete.');
      const enviados = await sendPack(sock, msg, {
        name: pick.name,
        publisher: config.packname,
        stickers,
      });
      await reply(sock, msg, `📦 *${pick.name}* enviado (${enviados}/${stickers.length} stickers)`);
    } else {
      let enviados = 0;
      for (const f of pick.files.slice(0, 10)) {
        try {
          const buf = await downloadSticker(pick.prefix + f);
          const webp = buf.toString('ascii', 0, 4) === 'RIFF' ? buf : await mediaToSticker(buf);
          await sendSticker(sock, msg, webp);
          enviados++;
        } catch (e) {
          console.error('[searchs] sticker:', e.message);
        }
      }
      if (!enviados) return reply(sock, msg, '❌ No se pudieron descargar los stickers.');
    }
    await react(sock, msg, '✅');
  } catch (e) {
    console.error('[search pick]', e);
    await reply(sock, msg, `❌ Error: ${e.message}`);
  }
  return true;
}

// ── .brat / .bratv ──────────────────────────────────────────────────
export async function brat(sock, msg, args) {
  const text = (args || []).join(' ').trim();
  if (!text) return reply(sock, msg, `📌 Uso: ${P}brat <texto>\nEjemplo: ${P}brat hola mundo`);
  await react(sock, msg, '⏳');
  try {
    const img = await fetchBrat(text);
    const webp = await mediaToSticker(img);
    await sendSticker(sock, msg, webp);
    await react(sock, msg, '✅');
  } catch (e) {
    console.error('[brat]', e);
    await reply(sock, msg, `❌ No se pudo generar el brat: ${e.message}`);
  }
}

export async function bratv(sock, msg, args) {
  const text = (args || []).join(' ').trim();
  if (!text) return reply(sock, msg, `📌 Uso: ${P}bratv <texto>\nEjemplo: ${P}bratv hola mundo`);
  await react(sock, msg, '⏳');
  try {
    const video = await fetchBratVideo(text);
    const webp = await mediaToSticker(video, { forzarTipo: 'video' });
    await sendSticker(sock, msg, webp);
    await react(sock, msg, '✅');
  } catch (e) {
    console.error('[bratv]', e);
    await reply(sock, msg, `❌ No se pudo generar el brat video: ${e.message}`);
  }
}
