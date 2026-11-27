// proto/aplicar-proto.js — Activa los stickers CON AUDIO en Baileys
//
// WhatsApp lanzó los "sound stickers" (octubre-noviembre 2026): un sticker que
// lleva el audio embebido en el propio mensaje. En el protocolo es
// StickerMessage.audioMessage (campo 26), tal como lo define whatsmeow:
//
//     message StickerMessage {
//         oneof audio { AudioMessage audioMessage = 26; }
//         ...
//     }
//
// Baileys 7.0.0-rc14 todavía no incluye ese campo en su proto generado.
// Como WAProto/index.js es un módulo estático, aquí reescribimos SOLO la clase
// StickerMessage para añadir el campo. Es idempotente y se ejecuta al arrancar.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const MARCA = 'StickerMessage.prototype.audioMessage = null;';
const CAMPO = 26;

function rutaProtoBaileys() {
  const pkg = require.resolve('@whiskeysockets/baileys/package.json');
  return path.join(path.dirname(pkg), 'WAProto', 'index.js');
}

export function protoYaParcheado(ruta = rutaProtoBaileys()) {
  try {
    return fs.readFileSync(ruta, 'utf8').includes(MARCA);
  } catch {
    return false;
  }
}

/** Reescribe solo la clase StickerMessage del proto de Baileys */
export function aplicarProto(ruta = rutaProtoBaileys()) {
  let s;
  try {
    s = fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    return { ok: false, motivo: `No encuentro el proto de Baileys (${e.code})` };
  }

  if (protoYaParcheado(ruta)) return { ok: true, yaEstaba: true };

  // ── Punto de anclaje: el prototipo de StickerMessage ──────────────
  const ancla = 'StickerMessage.prototype.mediaKeyDomain = null;';
  const idx = s.indexOf(ancla);
  if (idx === -1) {
    return { ok: false, motivo: 'Estructura del proto no reconocida (versión no soportada)' };
  }
  let salida = s.slice(0, idx + ancla.length) + '\n            ' + MARCA + s.slice(idx + ancla.length);

  // ── encode(): añadir el campo 26 (26 << 3 | 2 = 210) ─────────────
  // Ojo: en el proto generado, encode() va ANTES de decode()
  const idxEncode = salida.indexOf('StickerMessage.encode = function encode', idx);
  if (idxEncode === -1) return { ok: false, motivo: 'No encuentro StickerMessage.encode' };
  const idxReturnEncode = salida.indexOf('return w;', idxEncode);
  if (idxReturnEncode === -1) return { ok: false, motivo: 'No encuentro el cierre de encode()' };

  const campoEncode =
    `if (m.audioMessage != null && Object.hasOwnProperty.call(m, "audioMessage"))\n` +
    `                    $root.proto.Message.AudioMessage.encode(m.audioMessage, w.uint32(${(CAMPO << 3) | 2}).fork()).ldelim();\n                `;
  salida = salida.slice(0, idxReturnEncode) + campoEncode + salida.slice(idxReturnEncode);

  // ── decode(): añadir el case 26 ──────────────────────────────────
  const idxDecode = salida.indexOf('StickerMessage.decode = function decode', idxEncode);
  if (idxDecode === -1) return { ok: false, motivo: 'No encuentro StickerMessage.decode' };
  const idxDefault = salida.indexOf('default:', idxDecode);
  if (idxDefault === -1) return { ok: false, motivo: 'No encuentro el switch de decode()' };

  const casoDecode =
    `case ${CAMPO}: {\n` +
    '                            m.audioMessage = $root.proto.Message.AudioMessage.decode(r, r.uint32());\n' +
    '                            break;\n' +
    '                        }\n                    ';
  salida = salida.slice(0, idxDefault) + casoDecode + salida.slice(idxDefault);

  // ── fromObject(): interpretar audioMessage ───────────────────────
  const idxFrom = salida.indexOf('StickerMessage.fromObject = function fromObject', idxDecode);
  if (idxFrom === -1) return { ok: false, motivo: 'No encuentro StickerMessage.fromObject' };
  const idxReturnFrom = salida.indexOf('return m;', idxFrom);
  if (idxReturnFrom === -1) return { ok: false, motivo: 'No encuentro el cierre de fromObject()' };

  const campoFrom =
    `if (d.audioMessage != null) {\n` +
    '                    if (typeof d.audioMessage !== "object")\n' +
    '                        throw TypeError(".proto.Message.StickerMessage.audioMessage: object expected");\n' +
    '                    m.audioMessage = $root.proto.Message.AudioMessage.fromObject(d.audioMessage);\n' +
    '                }\n                ';
  salida = salida.slice(0, idxReturnFrom) + campoFrom + salida.slice(idxReturnFrom);

  // ── toObject(): incluir audioMessage al convertir ────────────────
  const idxTo = salida.indexOf('StickerMessage.toObject = function toObject', idxFrom);
  if (idxTo === -1) return { ok: false, motivo: 'No encuentro StickerMessage.toObject' };
  const idxReturnTo = salida.indexOf('return d;', idxTo);
  if (idxReturnTo === -1) return { ok: false, motivo: 'No encuentro el cierre de toObject()' };

  const campoTo =
    `if (m.audioMessage != null && m.hasOwnProperty("audioMessage")) {\n` +
    '                    d.audioMessage = $root.proto.Message.AudioMessage.toObject(m.audioMessage, o);\n' +
    '                }\n                ';
  salida = salida.slice(0, idxReturnTo) + campoTo + salida.slice(idxReturnTo);

  // Respaldo limpio del original
  const respaldo = `${ruta}.original`;
  try {
    if (!fs.existsSync(respaldo)) fs.copyFileSync(ruta, respaldo);
  } catch {}

  try {
    fs.writeFileSync(ruta, salida, 'utf8');
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
