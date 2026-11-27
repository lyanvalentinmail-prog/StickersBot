// lib/media.js — Descarga de medios (mensajes, TikTok, URLs)
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

export const isTikTokUrl = (url) =>
  /(?:https?:\/\/)?(?:www\.)?(?:vm\.|vt\.|t\.)?tiktok\.com\/[^\s]+/i.test(url || '');
export const isUrl = (text) => /^https?:\/\/[^\s]+$/i.test(text || '');

function downloadOpts(sock) {
  return {
    logger,
    reuploadRequest: sock.reuploadRequest,
    getAuth: () => sock.authState,
  };
}

/** Descarga un mensaje citado (imagen/video). */
export async function downloadQuotedMedia(sock, msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  const tipo = quoted.imageMessage ? 'imageMessage' : quoted.videoMessage ? 'videoMessage' : null;
  if (!tipo) return null;
  const ctx = msg.message.extendedTextMessage.contextInfo;
  const fake = {
    key: {
      remoteJid: msg.key.remoteJid,
      id: ctx.stanzaId,
      fromMe: false,
      participant: ctx.participant,
    },
    message: { [tipo]: quoted[tipo] },
  };
  const buffer = await downloadMediaMessage(fake, 'buffer', {}, downloadOpts(sock));
  return { buffer, type: tipo === 'imageMessage' ? 'image' : 'video' };
}

/** Descarga la imagen/video del mensaje actual (si lo tiene). */
export async function downloadDirectMedia(sock, msg) {
  const m = msg.message;
  const tipo = m?.imageMessage ? 'imageMessage' : m?.videoMessage ? 'videoMessage' : null;
  if (!tipo) return null;
  const buffer = await downloadMediaMessage(msg, 'buffer', {}, downloadOpts(sock));
  return { buffer, type: tipo === 'imageMessage' ? 'image' : 'video' };
}

/** Media citada o directa (lo que encuentre primero). */
export async function getMessageMedia(sock, msg) {
  return (await downloadQuotedMedia(sock, msg)) || (await downloadDirectMedia(sock, msg));
}

/** Descarga un archivo desde una URL (con límite de tamaño). */
export async function downloadUrl(url, maxMB = 25) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar el enlace`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxMB * 1024 * 1024) throw new Error('El archivo es demasiado grande');
  return buf;
}

/**
 * Descarga un video de TikTok.
 * 1) tikwm (sin clave)  2) api.delirius.online como respaldo.
 */
export async function downloadTikTok(url) {
  // 1) tikwm
  try {
    const res = await fetch(`https://api.tikwm.com/?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': UA },
    });
    const json = await res.json();
    const videoUrl = json?.data?.hdplay || json?.data?.play;
    if (videoUrl) return await downloadUrl(videoUrl, 50);
  } catch {
    /* sigue al respaldo */
  }

  // 2) delirius
  try {
    const res = await fetch(
      `https://api.delirius.online/download/tiktok?url=${encodeURIComponent(url)}`,
      { headers: { 'User-Agent': UA } }
    );
    const ct = res.headers.get('content-type') || '';
    if (ct.startsWith('video/')) return Buffer.from(await res.arrayBuffer());
    const json = await res.json().catch(() => null);
    const videoUrl = json?.result?.url || json?.data?.url || json?.url;
    if (videoUrl) return await downloadUrl(videoUrl, 50);
  } catch {
    /* sin respaldo */
  }

  throw new Error('No se pudo descargar el video de TikTok');
}
