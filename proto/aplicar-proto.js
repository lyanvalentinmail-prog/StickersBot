// proto/aplicar-proto.js — Activa los stickers CON AUDIO de WhatsApp en Baileys
//
// Un "sound sticker" de WhatsApp no es un sticker normal: viaja en un envoltorio
// FutureProofMessage y el audio va anidado dentro del propio StickerMessage:
//
//   Message
//    └─ 134 Message.audioStickerMessage (FutureProofMessage)
//         └─ 1 Message
//              └─ 26 Message.stickerMessage (WebP)
//                   └─ 26 StickerMessage.audioMessage (Ogg/Opus + streamingSidecar)
//
// Ninguno de esos dos campos existe en el proto de Baileys 7.0.0-rc14, así que
// aquí los añadimos reescribiendo solo las clases Message y StickerMessage.
// Formato contrastado con tres implementaciones en producción:
//   - coelhobugado/whatsapp-figurinhas-com-som  (src/sound-sticker.ts)
//   - raditted/whatsapp-sound-sticker           (scripts/patch-baileys.js)
//   - rezzxzx/Baileys (fork @vlyzer, stickerAudio)
//
// Es idempotente y se ejecuta en postinstall y al arrancar el bot.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const CAMPO_AUDIO_STICKER = 26;  // StickerMessage.audioMessage (oneof audio)
const CAMPO_ENVOLTORIO = 134;    // Message.audioStickerMessage (FutureProofMessage)
const CAMPO_STICKER = 26;        // Message.stickerMessage

const MARCA_STICKER = 'StickerMessage.prototype.audioMessage = null;';
const MARCA_MSG = 'Message.prototype.audioStickerMessage = null;';

function rutaProtoBaileys() {
  const pkg = require.resolve('@whiskeysockets/baileys/package.json');
  return path.join(path.dirname(pkg), 'WAProto', 'index.js');
}

export function protoYaParcheado(ruta = rutaProtoBaileys()) {
  try {
    const s = fs.readFileSync(ruta, 'utf8');
    return s.includes(MARCA_STICKER) && s.includes(MARCA_MSG);
  } catch {
    return false;
  }
}

/** Inserta `texto` justo después de `ancla` (debe existir una sola vez) */
function insertarTras(s, ancla, texto) {
  const i = s.indexOf(ancla);
  if (i === -1) return null;
  // Debe ser única para no parchear la clase equivocada
  if (s.indexOf(ancla, i + 1) !== -1) return null;
  return s.slice(0, i + ancla.length) + texto + s.slice(i + ancla.length);
}

// ── StickerMessage.audioMessage (campo 26) ─────────────────────────
function parchearStickerMessage(s) {
  if (s.includes(MARCA_STICKER)) return s;

  // 1. Campo en el prototipo
  let out = insertarTras(
    s,
    'StickerMessage.prototype.mediaKeyDomain = null;',
    `\n            ${MARCA_STICKER}`
  );
  if (!out) return null;

  // 2. Getter/setter del oneof
  out = insertarTras(
    out,
    'Object.defineProperty(StickerMessage.prototype, "_mediaKeyDomain", {\n' +
      '                get: $util.oneOfGetter($oneOfFields = ["mediaKeyDomain"]),\n' +
      '                set: $util.oneOfSetter($oneOfFields)\n' +
      '            });',
    '\n\n            // Sound sticker: audio embebido en el sticker\n' +
      '            Object.defineProperty(StickerMessage.prototype, "audio", {\n' +
      '                get: $util.oneOfGetter($oneOfFields = ["audioMessage"]),\n' +
      '                set: $util.oneOfSetter($oneOfFields)\n' +
      '            });'
  );
  if (!out) return null;

  // 3. encode(): campo 26 (26<<3|2 = 210), justo antes del "return w;"
  const idxEnc = out.indexOf('\n            StickerMessage.encode = function encode');
  if (idxEnc === -1) return null;
  const marcaDec = '\n            StickerMessage.decode = function decode';
  const idxRetEnc = out.indexOf('return w;', idxEnc);
  const limEnc = out.indexOf(marcaDec, idxEnc);
  if (idxRetEnc === -1 || limEnc === -1 || idxRetEnc > limEnc) return null;
  const campoEnc =
    `if (m.audioMessage != null && Object.hasOwnProperty.call(m, "audioMessage"))\n` +
    `                    $root.proto.Message.AudioMessage.encode(m.audioMessage, w.uint32(${(CAMPO_AUDIO_STICKER << 3) | 2}).fork()).ldelim();\n                `;
  out = out.slice(0, idxRetEnc) + campoEnc + out.slice(idxRetEnc);

  // 4. decode(): case 26
  const idxDec = out.indexOf('\n            StickerMessage.decode = function decode');
  if (idxDec === -1) return null;
  const idxDefault = out.indexOf('default:', idxDec);
  if (idxDefault === -1) return null;
  const casoDec =
    `case ${CAMPO_AUDIO_STICKER}: {\n` +
    '                            m.audioMessage = $root.proto.Message.AudioMessage.decode(r, r.uint32());\n' +
    '                            break;\n' +
    '                        }\n                    ';
  out = out.slice(0, idxDefault) + casoDec + out.slice(idxDefault);

  // 5. fromObject()
  const idxFrom = out.indexOf('\n            StickerMessage.fromObject = function fromObject');
  if (idxFrom === -1) return null;
  const idxRetFrom = out.indexOf('return m;', idxFrom);
  if (idxRetFrom === -1) return null;
  const campoFrom =
    `if (d.audioMessage != null) {\n` +
    '                    if (typeof d.audioMessage !== "object")\n' +
    '                        throw TypeError(".proto.Message.StickerMessage.audioMessage: object expected");\n' +
    '                    m.audioMessage = $root.proto.Message.AudioMessage.fromObject(d.audioMessage);\n' +
    '                }\n                ';
  out = out.slice(0, idxRetFrom) + campoFrom + out.slice(idxRetFrom);

  // 6. toObject()
  const idxTo = out.indexOf('\n            StickerMessage.toObject = function toObject');
  if (idxTo === -1) return null;
  const idxRetTo = out.indexOf('return d;', idxTo);
  if (idxRetTo === -1) return null;
  const campoTo =
    `if (m.audioMessage != null && m.hasOwnProperty("audioMessage")) {\n` +
    '                    d.audioMessage = $root.proto.Message.AudioMessage.toObject(m.audioMessage, o);\n' +
    '                }\n                ';
  out = out.slice(0, idxRetTo) + campoTo + out.slice(idxRetTo);

  return out;
}

// ── Message.audioStickerMessage (campo 134) ────────────────────────
function parchearMessage(s) {
  if (s.includes(MARCA_MSG)) return s;

  // 1. Campo en el prototipo
  let out = insertarTras(s, 'Message.prototype.pollResultSnapshotMessageV3 = null;', `\n        ${MARCA_MSG}`);
  if (!out) return null;

  // 2. oneof getter/setter
  out = insertarTras(
    out,
    'Object.defineProperty(Message.prototype, "_pollResultSnapshotMessageV3", {\n' +
      '            get: $util.oneOfGetter($oneOfFields = ["pollResultSnapshotMessageV3"]),\n' +
      '            set: $util.oneOfSetter($oneOfFields)\n' +
      '        });',
    '\n\n        // Sound sticker: envoltorio FutureProofMessage (campo 134)\n' +
      '        Object.defineProperty(Message.prototype, "_audioStickerMessage", {\n' +
      '            get: $util.oneOfGetter($oneOfFields = ["audioStickerMessage"]),\n' +
      '            set: $util.oneOfSetter($oneOfFields)\n' +
      '        });'
  );
  if (!out) return null;

  // 3. encode(): 134<<3|2 = 1074
  const idxEnc = out.indexOf('\n        Message.encode = function encode');
  if (idxEnc === -1) return null;
  const idxDec = out.indexOf('\n        Message.decode = function decode', idxEnc);
  if (idxDec === -1) return null;
  const idxRetEnc = out.indexOf('return w;', idxEnc);
  if (idxRetEnc === -1 || idxRetEnc > idxDec) return null;
  const campoEnc =
    `if (m.audioStickerMessage != null && Object.hasOwnProperty.call(m, "audioStickerMessage"))\n` +
    `                $root.proto.Message.FutureProofMessage.encode(m.audioStickerMessage, w.uint32(${(CAMPO_ENVOLTORIO << 3) | 2}).fork()).ldelim();\n            `;
  out = out.slice(0, idxRetEnc) + campoEnc + out.slice(idxRetEnc);

  // 4. decode(): case 134
  const idxDec2 = out.indexOf('\n        Message.decode = function decode');
  if (idxDec2 === -1) return null;
  const idxDefault = out.indexOf('default:', idxDec2);
  if (idxDefault === -1) return null;
  const casoDec =
    `case ${CAMPO_ENVOLTORIO}: {\n` +
    '                        m.audioStickerMessage = $root.proto.Message.FutureProofMessage.decode(r, r.uint32());\n' +
    '                        break;\n' +
    '                    }\n                    ';
  out = out.slice(0, idxDefault) + casoDec + out.slice(idxDefault);

  // 5. fromObject()
  const idxFrom = out.indexOf('\n        Message.fromObject = function fromObject');
  if (idxFrom === -1) return null;
  const idxRetFrom = out.indexOf('return m;', idxFrom);
  if (idxRetFrom === -1) return null;
  const campoFrom =
    `if (d.audioStickerMessage != null) {\n` +
    '                    if (typeof d.audioStickerMessage !== "object")\n' +
    '                        throw TypeError(".proto.Message.audioStickerMessage: object expected");\n' +
    '                    m.audioStickerMessage = $root.proto.Message.FutureProofMessage.fromObject(d.audioStickerMessage);\n' +
    '                }\n                ';
  out = out.slice(0, idxRetFrom) + campoFrom + out.slice(idxRetFrom);

  // 6. toObject()
  const idxTo = out.indexOf('\n        Message.toObject = function toObject');
  if (idxTo === -1) return null;
  const idxRetTo = out.indexOf('return d;', idxTo);
  if (idxRetTo === -1) return null;
  const campoTo =
    `if (m.audioStickerMessage != null && m.hasOwnProperty("audioStickerMessage")) {\n` +
    '                    d.audioStickerMessage = $root.proto.Message.FutureProofMessage.toObject(m.audioStickerMessage, o);\n' +
    '                    if (o.oneofs)\n' +
    '                        d._audioStickerMessage = "audioStickerMessage";\n' +
    '                }\n                ';
  out = out.slice(0, idxRetTo) + campoTo + out.slice(idxRetTo);

  return out;
}

/** Reescribe las dos clases necesarias del proto de Baileys */
export function aplicarProto(ruta = rutaProtoBaileys()) {
  let s;
  try {
    s = fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    return { ok: false, motivo: `No encuentro el proto de Baileys (${e.code})` };
  }

  if (protoYaParcheado(ruta)) return { ok: true, yaEstaba: true };

  const conSticker = parchearStickerMessage(s);
  if (!conSticker) {
    return { ok: false, motivo: 'No pude parchear StickerMessage (versión no soportada)' };
  }
  const conTodo = parchearMessage(conSticker);
  if (!conTodo) {
    return { ok: false, motivo: 'No pude parchear Message.audioStickerMessage' };
  }

  const respaldo = `${ruta}.original`;
  try {
    if (!fs.existsSync(respaldo)) fs.copyFileSync(ruta, respaldo);
  } catch {}

  try {
    fs.writeFileSync(ruta, conTodo, 'utf8');
  } catch (e) {
    return { ok: false, motivo: `No se pudo escribir (${e.code || e.message})` };
  }

  return { ok: true, destino: ruta };
}

export function asegurarProto() {
  const ruta = rutaProtoBaileys();
  if (protoYaParcheado(ruta)) return { ok: true, yaEstaba: true };
  return aplicarProto(ruta);
}

export function restaurarProto() {
  const ruta = rutaProtoBaileys();
  const respaldo = `${ruta}.original`;
  if (fs.existsSync(respaldo)) {
    fs.copyFileSync(respaldo, ruta);
    return true;
  }
  return false;
}

// ── Extensión del proto EN MEMORIA ─────────────────────────────────
//
// Si el bot ya cargó `@whiskeysockets/baileys`, parchear WAProto/index.js en
// disco NO surte efecto: el módulo está en caché y su `Message.encode` sigue
// siendo el original. Aquí añadimos `audioMessage` a StickerMessage en el proto
// ya cargado para que fromObject/toObject/encode/decode lo conserven.

let encodeInstalado = false;

/** Añade el campo `audioMessage` a la clase StickerMessage cargada en memoria */
export function instalarEncodeEnMemoria(proto) {
  if (encodeInstalado) return true;
  const SM = proto?.Message?.StickerMessage;
  if (!SM || typeof SM.encode !== 'function') return false;

  // 1. Campo en el prototipo (fromObject/toObject lo necesitan)
  if (!('audioMessage' in SM.prototype)) SM.prototype.audioMessage = null;
  if (!('audioMessage' in SM.prototype)) return false;

  // 2. encode: escribir el campo 26 (26<<3|2 = 210)
  if (!SM.__encodeParcheado) {
    const encodeOriginal = SM.encode;
    SM.encode = function encode(m, w) {
      const salida = encodeOriginal.call(SM, m, w);
      if (salida && typeof salida.uint32 === 'function' && m?.audioMessage != null) {
        salida.uint32(210);
        salida.bytes(proto.Message.AudioMessage.encode(m.audioMessage).finish());
      }
      return salida;
    };
    SM.__encodeParcheado = true;
  }

  encodeInstalado = true;
  return true;
}

/** Comprueba que el campo se conserva al serializar */
export function camposStickerSoportados(proto) {
  try {
    const SM = proto?.Message?.StickerMessage;
    if (!SM || !('audioMessage' in SM.prototype)) return false;

    // Asignación directa: es como lo hace el envío real (fromObject solo copia
    // los campos que conoce de antemano)
    const prueba = SM.fromObject({ mimetype: 'image/webp' });
    prueba.audioMessage = proto.Message.AudioMessage.fromObject({ seconds: 3 });
    const bytes = SM.encode(prueba).finish();

    // 26 << 3 | 2 = 210 = 0xD2, y el campo 26 de AudioMessage.seconds
    return bytes.toString('hex').includes('d201');
  } catch {
    return false;
  }
}

// Uso directo: node proto/aplicar-proto.js [--restaurar]
if (process.argv[1] && path.basename(process.argv[1]) === 'aplicar-proto.js') {
  if (process.argv.includes('--restaurar')) {
    console.log(restaurarProto() ? '✅ Proto original restaurado' : '⚠️ No hay respaldo');
  } else {
    const r = asegurarProto();
    console.log(r.ok ? (r.yaEstaba ? '✅ Ya estaba parcheado' : '✅ Proto parcheado (stickers con audio)') : `❌ ${r.motivo}`);
    process.exit(r.ok ? 0 : 1);
  }
}
