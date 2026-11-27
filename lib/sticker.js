// lib/sticker.js — Conversión de medios a sticker WebP con ffmpeg
// Escala a 512x512 + elimina los bordes negros (cropdetect)
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

/** Comprueba si ffmpeg está instalado */
export function checkFfmpeg() {
  return new Promise((resolve) => {
    execFile(FFMPEG, ['-version'], (err, stdout) => {
      if (err) return resolve(false);
      resolve(String(stdout).includes('ffmpeg'));
    });
  });
}

function tmpFile(ext) {
  const name = `sb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  return path.join(os.tmpdir(), name);
}

export function cleanup(...files) {
  for (const f of files) {
    if (!f) continue;
    try {
      fs.rmSync(f, { force: true, recursive: true });
    } catch {}
  }
}

/** Ejecuta ffmpeg y devuelve {ok, stderr} */
function run(label, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const t = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    proc.on('error', (e) => {
      clearTimeout(t);
      resolve({ ok: false, stderr: `${label}: ${e.message}` });
    });
    proc.on('close', (code) => {
      clearTimeout(t);
      const ultimo = stderr.trim().split('\n').slice(-3).join(' | ');
      resolve({ ok: code === 0, stderr: code === 0 ? '' : `${label}: ${ultimo}` });
    });
  });
}

/** Lee los metadatos con ffmpeg -i (respaldo si no hay ffprobe) */
function probeConFfmpeg(file) {
  return new Promise((resolve) => {
    execFile(FFMPEG, ['-hide_banner', '-i', file], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const txt = `${stderr || ''}${stdout || ''}`;
      if (!txt) return resolve(null);
      const dur = txt.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      const duracion = dur
        ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
        : 0;
      const video = /Stream #\d+:\d+.*?: Video:/.test(txt);
      const audio = /Stream #\d+:\d+.*?: Audio:/.test(txt);
      const dim = txt.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      resolve({
        duracion,
        ancho: dim ? Number(dim[1]) : 0,
        alto: dim ? Number(dim[2]) : 0,
        tieneVideo: video,
        tieneAudio: audio,
        videoCodec: '',
        audioCodec: '',
      });
    });
  });
}

/** Metadatos del archivo: duración, dimensiones, flujos */
export function probe(file) {
  return new Promise((resolve) => {
    execFile(
      FFPROBE,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      async (err, stdout) => {
        if (err) return resolve(await probeConFfmpeg(file));
        try {
          const data = JSON.parse(stdout);
          const v = (data.streams || []).find((s) => s.codec_type === 'video');
          const a = (data.streams || []).find((s) => s.codec_type === 'audio');
          const durFormat = parseFloat(data.format?.duration || '0');
          let duracion = durFormat > 0 ? durFormat : parseFloat(v?.duration || '0') || 0;
          if (!(duracion > 0) && v) {
            const nbf = Number(v.nb_frames || 0);
            const rate = (v.avg_frame_rate || '0/0').split('/').map(Number);
            if (nbf && rate[1]) duracion = nbf / (rate[0] / rate[1]);
          }
          resolve({
            duracion,
            ancho: Number(v?.width || 0),
            alto: Number(v?.height || 0),
            tieneVideo: !!v,
            tieneAudio: !!a,
            videoCodec: v?.codec_name || '',
            audioCodec: a?.codec_name || '',
          });
        } catch {
          resolve(await probeConFfmpeg(file));
        }
      }
    );
  });
}

/**
 * Detecta los bordes negros del video (cropdetect) y devuelve el área útil.
 * Si no hay bordes o falla, devuelve null.
 */
async function detectarBordes(file, duracion) {
  return new Promise((resolve) => {
    const ventana = duracion > 0 ? Math.min(Math.max(duracion * 0.8, 0.5), 5) : 5;
    const args = [
      '-hide_banner',
      '-nostats',
      '-i', file,
      '-t', String(ventana),
      '-vf', 'cropdetect=limit=24:round=2:reset=0',
      '-f', 'null',
      '-',
    ];
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 200000) err = err.slice(-200000);
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const matches = [...err.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
      if (!matches.length) return resolve(null);
      const [, w, h, x, y] = matches[matches.length - 1].map(Number);
      if (!w || !h || w < 16 || h < 16) return resolve(null);
      resolve({ ancho: w, alto: h, x, y });
    });
  });
}

/**
 * Cadena de filtros: recorta bordes negros, escala a `size`
 * conservando proporción y centra sobre un lienzo transparente.
 */
function filtro({ crop, size, fps, fade }) {
  const partes = [];
  if (crop) partes.push(`crop=${crop.ancho}:${crop.alto}:${crop.x}:${crop.y}`);
  partes.push(
    `scale=${size}:${size}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`
  );
  // Con canal alfa el relleno del lienzo es transparente (no negro)
  partes.push('format=rgba');
  partes.push(`pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`);
  partes.push('setsar=1');
  if (fade) partes.push('fade=t=in:st=0:d=0.12');
  // En las imágenes no hace falta fps; con fps=1 el WebP sale vacío
  if (fps > 1) partes.push(`fps=${fps}`);
  return partes.join(',');
}

function argumentosSticker({ entrada, salida, animado, crop, size, fps, duracion }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', entrada];

  if (animado) {
    args.push('-t', String(duracion));
    args.push('-vf', filtro({ crop, size, fps, fade: true }));
    args.push('-c:v', 'libwebp', '-preset', 'default', '-an', '-loop', '0', '-q:v', '45',
      '-compression_level', '4');
  } else {
    args.push('-frames:v', '1');
    args.push('-vf', filtro({ crop, size, fps: 0, fade: false }));
    args.push('-c:v', 'libwebp', '-q:v', '80', '-an');
  }
  args.push('-pix_fmt', 'yuva420p');
  args.push('-f', 'webp', salida);
  return args;
}

/**
 * Convierte una imagen o video en sticker WebP.
 * @returns {Promise<{ok:boolean, buffer?:Buffer, animado?:boolean, error?:string}>}
 */
export async function crearSticker(entrada, opts = {}) {
  const cfg = config.sticker;
  const size = opts.size || cfg.size;
  const fps = opts.fps || cfg.fps;

  const info = await probe(entrada);
  if (!info) return { ok: false, error: 'No pude leer el archivo (¿está dañado?)' };
  if (!info.tieneVideo) return { ok: false, error: 'El archivo no tiene video ni imagen' };

  const duracionMax = opts.duracionMax || cfg.duracionMax;
  const animado = opts.animado !== undefined
    ? opts.animado
    : info.duracion > cfg.duracionEstatica;

  const crop = await detectarBordes(entrada, info.duracion);
  const salida = tmpFile('webp');
  const base = { entrada, salida, animado, size, fps, duracion: duracionMax };

  let r = await run('sticker', argumentosSticker({ ...base, crop }));

  // Si el recorte falla (rotación, dimensiones raras), reintentamos sin él
  if (!r.ok && crop) {
    r = await run('sticker-sin-recorte', argumentosSticker({ ...base, crop: null }));
  }

  if (!r.ok) {
    cleanup(salida);
    return { ok: false, error: r.stderr };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(salida);
  } catch {
    cleanup(salida);
    return { ok: false, error: 'No se generó el sticker' };
  }
  cleanup(salida);

  if (buffer.length < cfg.minBytes) {
    return { ok: false, error: 'El sticker salió demasiado pequeño (archivo no válido)' };
  }

  return { ok: true, buffer, animado, recortado: !!crop };
}

/**
 * Extrae el audio del archivo como OGG/Opus (mono 48 kHz).
 * Con { paraSticker: true } respeta el límite de los sound stickers
 * de WhatsApp (5 s) y devuelve la duración real.
 */
export async function extraerAudio(entrada, opts = {}) {
  const cfg = config.audio;
  const maxDur = opts.paraSticker ? cfg.duracionSticker : cfg.duracionMax;
  const salida = tmpFile('ogg');
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', entrada,
    '-map', '0:a:0?',
    '-vn',
    '-t', String(maxDur),
    '-ac', '1',
    '-ar', '48000',
    '-c:a', 'libopus',
    '-b:a', cfg.bitrate,
    '-application', 'voip',
    '-f', 'ogg',
    salida,
  ];

  const r = await run('audio', args, 60000);
  if (!r.ok) {
    cleanup(salida);
    return { ok: false, error: r.stderr };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(salida);
  } catch {
    cleanup(salida);
    return { ok: false, error: 'No se generó el audio' };
  }

  if (buffer.length < 200 || buffer.subarray(0, 4).toString() !== 'OggS') {
    cleanup(salida);
    return { ok: false, error: 'El audio no salió en formato Opus' };
  }

  // Duración real del audio generado
  const info = await probe(salida).catch(() => null);
  const segundos = info?.duracion || 0;
  cleanup(salida);

  return { ok: true, buffer, bytes: buffer.length, segundos };
}

/**
 * Inserta nombre del pack y autor en el EXIF del WebP
 * (es lo que WhatsApp muestra al abrir el sticker).
 */
export function addExif(webpBuffer, packname, author) {
  const metadata = {
    'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    'android-app-store-link': 'https://play.google.com/store/apps/details?id=com.whatsapp',
    'ios-app-store-link': 'https://apps.apple.com/app/whatsapp-messenger/id310633997',
  };
  const json = Buffer.from(JSON.stringify(metadata), 'utf8');

  // Cabecera TIFF que espera WhatsApp (22 bytes, tipo 0x07 UNDEFINED, tag 0x5741)
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  exifAttr.writeUIntLE(json.length, 14, 4);

  const data = Buffer.concat([exifAttr, json]);
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write('EXIF', 0, 'ascii');
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);

  const limpio = quitarChunk(webpBuffer, 'EXIF');
  return insertarChunk(limpio, chunk);
}

function quitarChunk(buf, nombre) {
  if (buf.length < 12 || buf.subarray(0, 4).toString() !== 'RIFF') return buf;
  const partes = [];
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.subarray(pos, pos + 4).toString('latin1');
    const tam = buf.readUInt32LE(pos + 4);
    const total = 8 + tam + (tam % 2);
    if (pos + total > buf.length) break;
    if (id !== nombre) partes.push(buf.subarray(pos, pos + total));
    pos += total;
  }
  return recomponerRiff(buf.subarray(0, 12), partes);
}

/**
 * Añade el chunk EXIF al final (posición que indica la especificación WebP)
 * y activa el bit EXIF en la cabecera VP8X, que es lo que leen WhatsApp
 * y los decodificadores para reconocer los metadatos.
 */
function insertarChunk(buf, chunk) {
  if (buf.length < 12 || buf.subarray(0, 4).toString() !== 'RIFF') {
    return Buffer.concat([buf, chunk]);
  }

  const partes = [];
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.subarray(pos, pos + 4).toString('latin1');
    const tam = buf.readUInt32LE(pos + 4);
    const total = 8 + tam + (tam % 2);
    if (pos + total > buf.length) break;
    const trozo = Buffer.from(buf.subarray(pos, pos + total));
    // Activar la bandera EXIF (bit 0x08) en el primer byte de datos de VP8X
    if (id === 'VP8X' && tam >= 1) trozo[8] |= 0x08;
    partes.push(trozo);
    pos += total;
  }

  // El EXIF va al final; el XMP, si existe, se queda después
  const idxXmp = partes.findIndex((p) => p.subarray(0, 4).toString('latin1') === 'XMP ');
  if (idxXmp > -1) partes.splice(idxXmp, 0, chunk);
  else partes.push(chunk);

  return recomponerRiff(buf.subarray(0, 12), partes);
}

function recomponerRiff(cabeceraOriginal, partes) {
  const cabecera = Buffer.from(cabeceraOriginal);
  const cuerpo = Buffer.concat(partes);
  cabecera.writeUInt32LE(cuerpo.length + 4, 4); // tamaño RIFF
  return Buffer.concat([cabecera, cuerpo]);
}

export function detectarTipo(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const hex = buffer.subarray(0, 12).toString('hex').toUpperCase();
  if (hex.startsWith('FFD8FF')) return 'imagen';
  if (hex.startsWith('89504E47')) return 'imagen';
  if (hex.startsWith('47494638')) return 'imagen';
  if (hex.startsWith('52494646') && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (hex.slice(8, 16) === '66747970') return 'video';
  if (hex.startsWith('1A45DFA3')) return 'video';
  return null;
}
