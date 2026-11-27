// commands/s2.js — .s2 : video/foto/TikTok → sticker con audio
import config from '../config.js';
import {
  crearSticker, extraerAudio, addExif, detectarTipo, cleanup, probe,
} from '../lib/sticker.js';
import {
  descargarDelMensaje, descargarTikTok, descargar, esEnlace, esTikTok,
  extraerUrl, guardarTemporal,
} from '../lib/media.js';

const P = config.prefijo;

const AYUDA = `*${config.prefijo}${config.comando}* — sticker con audio

Responde a un *video* con *${P}${config.comando}*
o envía *${P}${config.comando} <enlace de TikTok>*

• Escala el video a 512×512
• Recorta los bordes negros
• Te manda el audio del video como nota de voz

_${config.packname} ${config.author}_`;

/** Envía el error al usuario */
async function avisar(sock, msg, texto) {
  await sock.sendMessage(msg.key.remoteJid, { text: texto }, { quoted: msg }).catch(() => {});
}

/** Reacciona (👍 / ❌) al mensaje */
async function reaccionar(sock, msg, emoji) {
  await sock
    .sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } })
    .catch(() => {});
}

export async function s2(sock, msg, args = []) {
  const jid = msg.key.remoteJid;
  let archivo = null;
  let stickerOk = false;

  try {
    // ¿El comando viene con un enlace? (.s2 https://vm.tiktok.com/...)
    const texto = args.join(' ');
    const url = extraerUrl(texto) || (esEnlace(texto) ? texto.trim() : null);

    let medio = null;

    if (url) {
      await reaccionar(sock, msg, '⏳');
      medio = esTikTok(url) ? await descargarTikTok(url) : await descargar(url);
    } else {
      // Sin enlace: debe responder a un video/foto
      await reaccionar(sock, msg, '⏳');
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

    const ext = tipo === 'video' ? 'mp4' : 'jpg';
    archivo = guardarTemporal(medio.buffer, ext);

    const info = await probe(archivo);
    if (!info || !info.tieneVideo) {
      await reaccionar(sock, msg, '❌');
      return avisar(sock, msg, '❌ No pude leer el archivo. Prueba con otro video.');
    }

    // ── Sticker ─────────────────────────────────────────────
    const sticker = await crearSticker(archivo, { animado: tipo === 'video' });
    if (!sticker.ok) {
      await reaccionar(sock, msg, '❌');
      return avisar(sock, msg, `❌ No pude crear el sticker.\n_${sticker.error}_`);
    }

    const webp = addExif(sticker.buffer, config.packname, config.author);
    stickerOk = true;

    await sock.sendMessage(
      jid,
      { sticker: webp },
      { quoted: msg }
    ).catch(async (e) => {
      stickerOk = false;
      await avisar(sock, msg, `❌ Error al enviar el sticker: ${e.message}`);
    });

    // ── Audio (nota de voz) ─────────────────────────────────
    if (stickerOk && info.tieneAudio) {
      const audio = await extraerAudio(archivo);
      if (audio.ok) {
        await sock.sendMessage(
          jid,
          { audio: audio.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true },
          { quoted: msg }
        ).catch(() => {});
      }
    }

    if (stickerOk) await reaccionar(sock, msg, '✅');
  } catch (e) {
    console.error('❌ .s2:', e);
    await reaccionar(sock, msg, '❌');
    await avisar(sock, msg, `❌ Ocurrió un error inesperado.\n_${e.message}_`);
  } finally {
    if (archivo) cleanup(archivo);
  }
}

export default s2;
