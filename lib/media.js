// lib/media.js — Descarga de medios (adjuntos, enlaces directos y TikTok)
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import config from '../config.js';
import { detectarTipo, cleanup } from './sticker.js';

const { timeoutMs, maxMB, userAgent } = config.descarga;

function tmpFile(ext) {
  return path.join(os.tmpdir(), `sb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`);
}

/** Descarga una URL con límite de tamaño y tiempo */
export async function descargar(url, intentos = 2) {
  let ultimoError = 'error desconocido';
  for (let i = 0; i < intentos; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': userAgent,
          Accept: '*/*',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        },
      });
      clearTimeout(timer);
      if (!res.ok) {
        ultimoError = `HTTP ${res.status}`;
        continue;
      }
      const largo = Number(res.headers.get('content-length') || 0);
      if (largo > maxMB * 1024 * 1024) {
        return { ok: false, error: `El archivo pesa más de ${maxMB} MB` };
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) {
        ultimoError = 'archivo vacío o muy pequeño';
        continue;
      }
      if (buffer.length > maxMB * 1024 * 1024) {
        return { ok: false, error: `El archivo pesa más de ${maxMB} MB` };
      }
      const tipo = detectarTipo(buffer);
      if (!tipo) {
        ultimoError = 'el enlace no es una imagen ni un video';
        continue;
      }
      return { ok: true, buffer, tipo };
    } catch (e) {
      clearTimeout(timer);
      ultimoError = e.name === 'AbortError' ? 'tiempo de descarga agotado' : e.message;
    }
  }
  return { ok: false, error: ultimoError };
}

/** Guarda un buffer en un archivo temporal */
export function guardarTemporal(buffer, ext) {
  const archivo = tmpFile(ext);
  fs.writeFileSync(archivo, buffer);
  return archivo;
}

export { cleanup };

/** Detector de enlaces */
export function esEnlace(texto) {
  return /^https?:\/\/\S+$/i.test((texto || '').trim());
}

export function esTikTok(texto) {
  return /(tiktok\.com|vt\.tiktok|vm\.tiktok|douyin\.com)/i.test(texto || '');
}

/** Extrae la primera URL de un texto */
export function extraerUrl(texto) {
  const m = String(texto || '').match(/https?:\/\/\S+/i);
  return m ? m[0].replace(/[)\]>,."']+$/, '') : null;
}

/** Descarga el video de TikTok (sin marca de agua si es posible) */
export async function descargarTikTok(url) {
  const errores = [];

  // 1) tikwm
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${config.tikwm}?url=${encodeURIComponent(url)}&hd=1`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    });
    clearTimeout(timer);
    const json = await res.json().catch(() => null);
    const d = json?.data;
    if (json?.code === 0 && d) {
      const candidatos = [d.hdplay, d.play, d.wmplay]
        .filter(Boolean)
        .map((u) => (u.startsWith('http') ? u : `https://www.tikwm.com${u}`));
      for (const u of candidatos) {
        const r = await descargar(u, 1);
        if (r.ok && r.tipo === 'video') return r;
      }
      errores.push('tikwm no devolvió un video descargable');
    } else {
      errores.push(`tikwm: ${json?.msg || 'respuesta inválida'}`);
    }
  } catch (e) {
    errores.push(`tikwm: ${e.message}`);
  }

  // 2) respaldo genérico
  try {
    const respaldo = `https://api.delirius.online/download/tiktok?url=${encodeURIComponent(url)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(respaldo, {
      signal: ctrl.signal,
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    });
    clearTimeout(timer);
    const json = await res.json().catch(() => null);
    const d = json?.resultado || json?.result || json?.data;
    const u = d?.video || d?.video_hd || d?.nowm || d?.url;
    if (u) {
      const r = await descargar(u, 1);
      if (r.ok && r.tipo === 'video') return r;
    }
    errores.push('respaldo sin video');
  } catch (e) {
    errores.push(`respaldo: ${e.message}`);
  }

  return {
    ok: false,
    error: `No pude descargar el video de TikTok (${errores.join(' / ') || 'sin detalles'})`,
  };
}

/** Descarga el medio citado o el del mensaje actual */
export async function descargarDelMensaje(sock, msg) {
  const citado = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (citado) {
    const objetivo = {
      key: {
        remoteJid: msg.key.remoteJid,
        id: msg.message.extendedTextMessage.contextInfo.stanzaId,
        participant: msg.message.extendedTextMessage.contextInfo.participant,
      },
      message: citado,
    };
    const buffer = await downloadMediaMessage(objetivo, 'buffer', {}, {
      logger: { level: 'silent', child: () => ({ level: 'silent', child: () => ({}) }) },
      reuploadRequest: sock.updateMediaMessage,
    }).catch(() => null);
    if (buffer) return { ok: true, buffer, tipo: detectarTipo(buffer) };
  }

  if (
    msg.message?.imageMessage ||
    msg.message?.videoMessage ||
    msg.message?.documentMessage ||
    msg.message?.audioMessage
  ) {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: { level: 'silent', child: () => ({ level: 'silent', child: () => ({}) }) },
      reuploadRequest: sock.updateMediaMessage,
    }).catch(() => null);
    if (buffer) return { ok: true, buffer, tipo: detectarTipo(buffer) };
  }

  return { ok: false, error: 'sin medio adjunto' };
}

export { tmpFile };
