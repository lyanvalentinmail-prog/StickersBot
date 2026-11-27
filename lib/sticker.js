// lib/sticker.js — Conversión de imágenes/videos a stickers con ffmpeg + EXIF (nombre/autor del paquete)
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import config from '../config.js';

const TMP_DIR = path.join(process.cwd(), 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

let contador = 0;
const tmpPath = (ext) => path.join(TMP_DIR, `s_${Date.now()}_${contador++}${ext}`);

// Verifica que ffmpeg esté instalado (en Termux: pkg install ffmpeg)
export function checkFfmpeg() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg falló: ${stderr.trim() || 'código ' + code}`));
    });
  });
}

// Detecta si el buffer es imagen o video por sus bytes mágicos
export function detectType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return 'unknown';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image'; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image'; // PNG
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image'; // GIF
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image'; // WEBP
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'video'; // MP4/MOV
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video'; // WEBM/MKV
  return 'unknown';
}

const ESCALA =
  'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';

async function convert(input, output, tipo, calidad) {
  if (tipo === 'image') {
    await runFfmpeg([
      '-i', input, '-vf', ESCALA, '-frames:v', '1', '-q:v', String(calidad), '-f', 'webp', output,
    ]);
  } else {
    await runFfmpeg([
      '-i', input,
      '-t', String(config.sticker.maxSegundos),
      '-vf', `fps=${config.sticker.fps},${ESCALA}`,
      '-loop', '0',
      '-q:v', String(calidad),
      '-f', 'webp', output,
    ]);
  }
}

/**
 * Convierte un buffer (imagen o video) en un sticker webp 512x512.
 * Si el resultado es muy pesado, reintenta con menor calidad.
 */
export async function mediaToSticker(buffer, { forzarTipo = null } = {}) {
  const tipo = forzarTipo || (detectType(buffer) === 'image' ? 'image' : 'video');
  const entrada = tmpPath('.bin');
  const salida = tmpPath('.webp');
  try {
    fs.writeFileSync(entrada, buffer);
    try {
      await convert(entrada, salida, tipo, 80);
    } catch (e) {
      // Si falló, prueba con el otro tipo (por si la detección falló)
      await convert(entrada, salida, tipo === 'image' ? 'video' : 'image', 80);
    }
    let stat = fs.statSync(salida);
    if (stat.size > 900 * 1024) {
      await convert(entrada, salida, tipo, 55);
      stat = fs.statSync(salida);
    }
    if (!stat.size) throw new Error('El sticker quedó vacío');
    return fs.readFileSync(salida);
  } finally {
    try { fs.unlinkSync(entrada); } catch { /* ya borrado */ }
    try { if (fs.existsSync(salida)) fs.unlinkSync(salida); } catch { /* ya borrado */ }
  }
}

/**
 * Extrae el audio de un video (ogg/opus, listo para nota de voz).
 * Lo usa .s2 para el "sticker con audio".
 */
export async function extractAudio(buffer, maxSeg = config.sticker.maxAudioSeg) {
  const entrada = tmpPath('.bin');
  const salida = tmpPath('.ogg');
  try {
    fs.writeFileSync(entrada, buffer);
    await runFfmpeg([
      '-i', entrada, '-vn',
      '-t', String(maxSeg),
      '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000', '-ac', '1',
      '-f', 'ogg', salida,
    ]);
    const buf = fs.readFileSync(salida);
    if (!buf.length || buf.toString('ascii', 0, 4) !== 'OggS') throw new Error('No se pudo extraer el audio');
    return buf;
  } finally {
    try { fs.unlinkSync(entrada); } catch { /* ya borrado */ }
    try { if (fs.existsSync(salida)) fs.unlinkSync(salida); } catch { /* ya borrado */ }
  }
}

// ── EXIF del sticker (nombre/autor del paquete) ─────────────────────
// WhatsApp muestra el nombre del paquete y el autor gracias al EXIF
// incrustado en el webp. Baileys no lo hace solo, así que lo inyectamos
// manualmente como chunk EXIF en el RIFF del WebP.

function exifBuffer(packname, author) {
  const payload = Buffer.from(
    JSON.stringify({
      'sticker-pack-id': `michi-bot-${Date.now()}`,
      'sticker-pack-name': packname,
      'sticker-pack-publisher': author,
      emojis: ['🌸'],
    }),
    'utf8'
  );
  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const exif = Buffer.concat([header, payload]);
  exif.writeUIntLE(payload.length, 14, 4);
  return exif;
}

/** Inserta (o reemplaza) el chunk EXIF en un webp. */
export function addStickerExif(webp, packname, author) {
  if (!Buffer.isBuffer(webp) || webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('El buffer no es un WebP válido');
  }
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const fourcc = webp.toString('ascii', offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4);
    const dataEnd = offset + 8 + size;
    if (dataEnd > webp.length) break; // chunk corrupto: corta acá
    if (fourcc !== 'EXIF') {
      chunks.push(webp.subarray(offset, dataEnd + (size % 2)));
    }
    offset = dataEnd + (size % 2);
  }
  const exif = exifBuffer(packname, author);
  const exifChunk = Buffer.alloc(8 + exif.length + (exif.length % 2));
  exifChunk.write('EXIF', 0, 'ascii');
  exifChunk.writeUInt32LE(exif.length, 4);
  exif.copy(exifChunk, 8);

  const body = Buffer.concat([...chunks, exifChunk]);
  const out = Buffer.alloc(12 + body.length);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(4 + body.length, 4);
  out.write('WEBP', 8, 'ascii');
  body.copy(out, 12);
  return out;
}
