// lib/soundsticker.js — Stickers CON AUDIO nativos de WhatsApp ("sound stickers")
//
// Formato: un StickerMessage normal que lleva un AudioMessage anidado en el
// campo 26 (oneof audio). NO lleva el sobre FutureProofMessage: envolverlo en
// Message.134 hace que WhatsApp reciba el mensaje como un sobre desconocido y
// la burbuja aparezca vacía, sin imagen ni información.
//
//   Message
//    └─ 26 stickerMessage (WebP 512×512 + miniatura + EXIF)
//         └─ 26 StickerMessage.audioMessage (Ogg/Opus + streamingSidecar)
//
// El campo 26 de StickerMessage lo añade proto/aplicar-proto.js (en disco y en
// memoria, porque Baileys ya está cargado cuando se ejecuta).
import { createCipheriv, createHash, createHmac, timingSafeEqual } from 'crypto';
import pino from 'pino';
import { instalarEncodeEnMemoria, camposStickerSoportados } from '../proto/aplicar-proto.js';

const logger = pino({ level: 'silent' });

const CAMPO_AUDIO_STICKER = 26;
const TAM_BLOQUE = 64 * 1024;

// ── streamingSidecar ────────────────────────────────────────────────

/**
 * Firma por bloques del audio cifrado: HMAC-SHA256 truncado a 10 bytes por cada
 * bloque de 64 KiB, encadenado con los 16 bytes anteriores (el IV en el primero).
 * Se re-cifra el audio con su mediaKey y se verifica fileEncSha256 antes de usarlo.
 */
export async function crearStreamingSidecar(b, audio, mediaKey, fileEncSha256) {
  const { iv, cipherKey, macKey } = await b.getMediaKeys(Buffer.from(mediaKey), 'audio');
  if (!iv || !cipherKey || !macKey) throw new Error('No pude derivar las claves del audio');

  const cipher = createCipheriv('aes-256-cbc', cipherKey, iv);
  const cifrado = Buffer.concat([cipher.update(audio), cipher.final()]);

  const mac = createHmac('sha256', macKey).update(iv).update(cifrado).digest().subarray(0, 10);
  const hash = createHash('sha256').update(cifrado).update(mac).digest();
  if (
    hash.length !== fileEncSha256.length ||
    !timingSafeEqual(hash, Buffer.from(fileEncSha256))
  ) {
    throw new Error('El audio cifrado no coincide con el que se subió');
  }

  const partes = [];
  for (let i = 0; i < cifrado.length; i += TAM_BLOQUE) {
    const previo = i === 0 ? iv : cifrado.subarray(i - 16, i);
    const bloque = cifrado.subarray(i, i + TAM_BLOQUE);
    partes.push(
      createHmac('sha256', macKey).update(previo).update(bloque).digest().subarray(0, 10)
    );
  }
  return Buffer.concat(partes);
}

/**
 * Comprueba que el proto acepta StickerMessage.audioMessage.
 * Instala el parche en memoria si hace falta.
 */
export async function soportaStickerConAudio() {
  try {
    const b = await import('@whiskeysockets/baileys');
    return instalarEncodeEnMemoria(b.proto) && camposStickerSoportados(b.proto);
  } catch {
    return false;
  }
}

/**
 * Sube el WebP y el audio, monta el sticker con el audio dentro y lo envía.
 * @returns {Promise<string>} id del mensaje
 */
export async function enviarStickerConAudio(sock, jid, datos, opts = {}) {
  const { webp, audio, segundos, animado = true, miniatura } = datos;
  const b = await import('@whiskeysockets/baileys');
  const { prepareWAMessageMedia } = b;

  if (!sock.user?.id) throw new Error('El socket aún no está autenticado');

  const opcionesMedia = {
    upload: sock.waUploadToServer,
    mediaUploadTimeoutMs: 60000,
    logger,
  };

  // 1. Subir el sticker
  const visual = await prepareWAMessageMedia(
    { sticker: webp, isAnimated: !!animado, width: 512, height: 512 },
    opcionesMedia
  );
  const stickerMessage = visual.stickerMessage;
  if (!stickerMessage) throw new Error('No se pudo preparar el sticker');

  // Datos que WhatsApp usa para pintar la burbuja
  stickerMessage.isAnimated = !!animado;
  stickerMessage.width = 512;
  stickerMessage.height = 512;
  stickerMessage.mimetype = 'image/webp';
  stickerMessage.stickerSentTs = Date.now();
  if (miniatura) stickerMessage.pngThumbnail = miniatura;

  // 2. Subir el audio y anidarlo DENTRO del sticker (campo 26)
  let audioMessage = null;
  if (audio && audio.length > 0) {
    const sonido = await prepareWAMessageMedia(
      {
        audio,
        mimetype: 'audio/ogg; codecs=opus',
        seconds: Math.max(1, Math.ceil(segundos || 1)),
      },
      opcionesMedia
    );
    audioMessage = sonido.audioMessage;
    if (!audioMessage?.mediaKey || !audioMessage.fileEncSha256) {
      throw new Error('No se pudo preparar el audio del sticker');
    }
    audioMessage.streamingSidecar = await crearStreamingSidecar(
      b,
      audio,
      audioMessage.mediaKey,
      audioMessage.fileEncSha256
    );

    stickerMessage.audioMessage = audioMessage;
  }

  // 3. Sin audio: sticker normal
  if (!audioMessage) {
    const envio = await sock.sendMessage(jid, { sticker: webp }, { quoted: opts.quoted });
    return envio?.key?.id;
  }

  // 4. Enviar: un StickerMessage normal con el audio dentro (sin sobre)
  const mensaje = b.generateWAMessageFromContent(
    jid,
    { stickerMessage },
    { userJid: sock.user.id, quoted: opts.quoted }
  );

  const contenido = mensaje.message;
  if (!contenido?.stickerMessage) throw new Error('No se pudo construir el mensaje');

  // La cita viaja en la estanza, no dentro del sticker
  const cita = contenido.stickerMessage.contextInfo;
  if (cita) delete contenido.stickerMessage.contextInfo;

  await sock.relayMessage(jid, contenido, {
    messageId: mensaje.key.id,
    ...(cita ? { quoted: opts.quoted } : {}),
  });

  return mensaje.key.id;
}

export default enviarStickerConAudio;
