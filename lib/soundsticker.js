// lib/soundsticker.js — Stickers CON AUDIO nativos de WhatsApp ("sound stickers")
//
// Formato real del protocolo (contrastado con tres implementaciones en producción:
// coelhobugado/whatsapp-figurinhas-com-som, raditted/whatsapp-sound-sticker y el
// fork rezzxzx/Baileys):
//
//   Message
//    └─ 134 Message.audioStickerMessage (FutureProofMessage)
//         └─ 1 Message
//              └─ 26 stickerMessage (WebP animado 512×512)
//                   └─ 26 StickerMessage.audioMessage (Ogg/Opus + streamingSidecar)
//
// Dos claves que hacen que WhatsApp reproduzca el sonido:
//   1. El envoltorio FutureProofMessage (campo 134), no un sticker suelto.
//   2. El `streamingSidecar` del audio: HMAC-SHA256 truncado a 10 bytes por cada
//      bloque de 64 KiB del archivo cifrado, encadenado con los 16 bytes previos.
//
// Los campos 134 y 26-de-StickerMessage los añade proto/aplicar-proto.js.
import { createCipheriv, createHash, createHmac, timingSafeEqual } from 'crypto';
import pino from 'pino';

const logger = pino({ level: 'silent' });

const CAMPO_AUDIO_STICKER = 26;
const CAMPO_STICKER = 26;
const CAMPO_ENVOLTORIO = 134;
const CAMPO_FUTURE_PROOF = 1;
const TAM_BLOQUE = 64 * 1024;

// ── Utilidades protobuf ─────────────────────────────────────────────

function varint(valor) {
  const bytes = [];
  let v = valor;
  do {
    let b = v % 128;
    v = Math.floor(v / 128);
    if (v) b |= 0x80;
    bytes.push(b);
  } while (v);
  return Buffer.from(bytes);
}

/** Campo de longitud (wire type 2) */
function campoLongitud(numero, payload) {
  return Buffer.concat([varint(numero * 8 + 2), varint(payload.length), payload]);
}

/** Bytes del mensaje tal cual van en el aire (protobuf). */
export function construirEnvoltorio(b, stickerMessage, audioMessage) {
  const stickerBytes = Buffer.concat([
    b.proto.Message.StickerMessage.encode(stickerMessage).finish(),
    campoLongitud(CAMPO_AUDIO_STICKER, b.proto.Message.AudioMessage.encode(audioMessage).finish()),
  ]);
  const interior = campoLongitud(CAMPO_STICKER, stickerBytes);
  return campoLongitud(CAMPO_FUTURE_PROOF, interior);
}

/**
 * streamingSidecar del audio: firma por bloques del archivo cifrado.
 * Se re-cifra el audio con la mediaKey del propio upload y se verifica el
 * hash antes de fiarse del resultado.
 */
export async function crearStreamingSidecar(b, audio, mediaKey, fileEncSha256) {
  const { iv, cipherKey, macKey } = await b.getMediaKeys(Buffer.from(mediaKey), 'audio');
  if (!iv || !cipherKey || !macKey) throw new Error('No pude derivar las claves del audio');

  const cipher = createCipheriv('aes-256-cbc', cipherKey, iv);
  const cifrado = Buffer.concat([cipher.update(audio), cipher.final()]);

  // Verificación: el hash debe coincidir con lo que subió WhatsApp
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

/** Comprueba si el proto tiene los dos campos necesarios */
export async function soportaStickerConAudio() {
  try {
    const b = await import('@whiskeysockets/baileys');
    const m = b.proto.Message.fromObject({
      audioStickerMessage: {
        message: { stickerMessage: { mimetype: 'image/webp', audioMessage: { seconds: 1 } } },
      },
    });
    if (!m.audioStickerMessage) return false;
    const dec = b.proto.Message.decode(b.proto.Message.encode(m).finish());
    return !!dec.audioStickerMessage?.message?.stickerMessage?.audioMessage;
  } catch {
    return false;
  }
}

/**
 * Sube el WebP y el audio, monta el mensaje de sound sticker y lo envía.
 * @returns {Promise<string>} id del mensaje
 */
export async function enviarStickerConAudio(sock, jid, datos, opts = {}) {
  const { webp, audio, segundos, animado = true } = datos;
  const b = await import('@whiskeysockets/baileys');
  const { prepareWAMessageMedia, generateWAMessageFromContent } = b;

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
  stickerMessage.isAnimated = !!animado;
  stickerMessage.stickerSentTs = Date.now();

  // 2. Subir el audio y calcular su streamingSidecar
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

    // El audio se anida DENTRO del StickerMessage (campo 26)
    stickerMessage.audioMessage = audioMessage;
  }

  // 3. Sin audio: sticker normal
  if (!audioMessage) {
    const envio = await sock.sendMessage(jid, { sticker: webp }, { quoted: opts.quoted });
    return envio?.key?.id;
  }

  // 4. Envolver en audioStickerMessage (campo 134) y enviar
  const contenido = {
    audioStickerMessage: { message: { stickerMessage } },
  };
  const mensaje = generateWAMessageFromContent(jid, contenido, {
    userJid: sock.user.id,
    quoted: opts.quoted,
  });

  await sock.relayMessage(jid, mensaje.message, { messageId: mensaje.key.id });
  return mensaje.key.id;
}

export default enviarStickerConAudio;
