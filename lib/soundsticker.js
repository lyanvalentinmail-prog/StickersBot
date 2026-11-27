// lib/soundsticker.js — Stickers CON AUDIO nativos de WhatsApp
//
// WhatsApp incorporó (octubre-noviembre 2026) los "sound stickers": un sticker
// normal que lleva un audio embebido en el propio mensaje. En el protocolo es
// StickerMessage.audioMessage (campo 26, oneof audio), descubierto en la
// definición de whatsmeow. Baileys todavía no lo incluye en su proto público,
// así que aplicamos un proto parcheado al arrancar (ver proto/aplicar-proto.js).
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

/** Compone el sticker (WebP) con su audio (OGG/Opus) en un solo mensaje */
export async function enviarStickerConAudio(sock, jid, { webp, audio, segundos, animado = true }, opts = {}) {
  const b = await import('@whiskeysockets/baileys');
  const { prepareWAMessageMedia, generateWAMessageFromContent, generateMessageIDV2 } = b;

  // 1. Subir el WebP como sticker
  const stickerMedia = await prepareWAMessageMedia(
    { sticker: webp, isAnimated: !!animado },
    { upload: sock.waUploadToServer }
  );
  const stickerMessage = stickerMedia.stickerMessage;
  if (!stickerMessage) throw new Error('No se pudo preparar el sticker');

  stickerMessage.isAnimated = !!animado;
  stickerMessage.stickerSentTs = Date.now();

  // 2. Subir el audio y anidarlo dentro del StickerMessage
  if (audio && audio.length > 0) {
    const audioMedia = await prepareWAMessageMedia(
      { audio, mimetype: 'audio/ogg; codecs=opus', ptt: false, seconds: Math.max(1, Math.round(segundos || 1)) },
      { upload: sock.waUploadToServer }
    );
    const audioMessage = audioMedia.audioMessage;
    if (!audioMessage) throw new Error('No se pudo preparar el audio');

    // El audio pertenece al sticker (no es un mensaje aparte)
    delete audioMessage.contextInfo;
    stickerMessage.audioMessage = audioMessage;
  }

  // 3. Construir y enviar el mensaje
  const fullMessage = generateWAMessageFromContent(
    jid,
    { stickerMessage },
    { userJid: sock.user?.id, quoted: opts.quoted }
  );

  await sock.relayMessage(jid, fullMessage.message, {
    messageId: fullMessage.key.id || generateMessageIDV2(sock.user?.id),
  });

  return fullMessage;
}

/** Comprueba si el proto cargado soporta audioMessage dentro de StickerMessage */
export async function soportaStickerConAudio() {
  try {
    const b = await import('@whiskeysockets/baileys');
    const prueba = b.proto.Message.StickerMessage.fromObject({
      audioMessage: { seconds: 1, mimetype: 'audio/ogg' },
    });
    if (!prueba.audioMessage) return false;
    const decodificado = b.proto.Message.decode(
      b.proto.Message.encode(
        b.proto.Message.fromObject({
          stickerMessage: { mimetype: 'image/webp', audioMessage: { seconds: 1 } },
        })
      ).finish()
    );
    return !!decodificado.stickerMessage?.audioMessage;
  } catch {
    return false;
  }
}

export default enviarStickerConAudio;
