// commands/s2.js — .s2 : video/foto/TikTok → STICKER CON AUDIO (nativo de WhatsApp)
import fs from 'fs';
import config from '../config.js';
import {
  crearSticker, extraerAudio, addExif, detectarTipo, cleanup, probe,
} from '../lib/sticker.js';
import {
  descargarDelMensaje, descargarTikTok, descargar, esEnlace, esTikTok,
  extraerUrl, guardarTemporal,
} from '../lib/media.js';
import { enviarStickerConAudio, soportaStickerConAudio } from '../lib/soundsticker.js';

const P = config.prefijo;

const AYUDA = `*${P}${config.comando}* — sticker CON AUDIO 🔊

Responde a un *video* con *${P}${config.comando}*
o envía *${P}${config.comando} <enlace de TikTok>*

• Escala el video a 512×512 y recorta los bordes negros
• El audio va *dentro del sticker*: tócalo para escucharlo

_${config.packname} ${config.author}_`;

async function avisar(sock, msg, texto) {
  await sock.sendMessage(msg.key.remoteJid, { text: texto }, { quoted: msg }).catch(() => {});
}

async function reaccionar(sock, msg, emoji) {
  await sock
    .sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } })
    .catch(() => {});
}

export async function s2(sock, msg, args = []) {
  const jid = msg.key.remoteJid;
  let archivo = null;

  try {
    const texto = args.join(' ');
    const url = extraerUrl(texto) || (esEnlace(texto) ? texto.trim() : null);

    let medio = null;
    await reaccionar(sock, msg, '⏳');

    if (url) {
      medio = esTikTok(url) ? await descargarTikTok(url) : await descargar(url);
    } else {
      medio = await descargarDelMensaje(sock, msg);
      if (!medio.ok) {
        await reaccionar(sock, msg, '❌');
        return avisar(sock, msg, AYUDA);
      }
    }

    if (!medio.ok) {
      await reaccionar(sock, msg, '❌');
      return avisar(sock, msg, `❌ ${medio.error}`);
    }

    const tipo = medio.tipo || detectarTipo(medio.buffer);
    if (!tipo || tipo === 'webp') {
      await reaccionar(sock, msg, '❌');
      return avisar(sock, msg, '❌ Envía una *foto* o un *video* (o un enlace de TikTok).');
    }

    archivo = guardarTemporal(medio.buffer, tipo === 'video' ? 'mp4' : 'jpg');

    const info = await probe(archivo);
    if (!info || !info.tieneVideo) {
      await reaccionar(sock, msg, '❌');
      return avisar(sock, msg, '❌ No pude leer el archivo. Prueba con otro video.');
    }

    // ── Sticker (WebP) ──────────────────────────────────────
    const sticker = await crearSticker(archivo, { animado: tipo === 'video' });
    if (!sticker.ok) {
      await reaccionar(sock, msg, '❌');
      return avisar(sock, msg, `❌ No pude crear el sticker.\n_${sticker.error}_`);
    }

    const webp = addExif(sticker.buffer, config.packname, config.author);

    // ── Audio para embeber en el sticker ────────────────────
    let audio = null;
    let segundos = 0;
    if (info.tieneAudio) {
      const extraido = await extraerAudio(archivo, { paraSticker: true });
      if (extraido.ok) {
        audio = extraido.buffer;
        segundos = extraido.segundos || config.audio.duracionSticker;
      }
    }

    // Sin audio no es un "sticker con audio": avisamos pero enviamos el sticker
    if (!audio) {
      await avisar(
        sock, msg,
        '⚠️ Ese video no tiene audio, así que el sticker va sin sonido.\n' +
        'Prueba con un video que sí lo tenga (o un TikTok con música).'
      );
    }

    // ── Envío: sticker + audio en UN SOLO mensaje ───────────
    const soportado = await soportaStickerConAudio();
    if (soportado) {
      await enviarStickerConAudio(
        sock, jid,
        { webp, audio, segundos },
        { quoted: msg }
      );
    } else {
      // Respaldo: proto sin parche (sticker normal + nota de voz)
      await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
      if (audio) {
        await sock.sendMessage(jid, {
          audio,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        }, { quoted: msg });
      }
    }

    await reaccionar(sock, msg, '✅');
  } catch (e) {
    console.error('❌ .s2:', e);
    await reaccionar(sock, msg, '❌');
    await avisar(sock, msg, `❌ Ocurrió un error inesperado.\n_${e.message}_`);
  } finally {
    if (archivo) cleanup(archivo);
  }
}

export default s2;
