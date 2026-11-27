// config.js — Ajustes del bot
export default {
  // Prefijo de los comandos
  prefijo: '.',

  botNombre: 'Sticker Bot',
  botVersion: '2.0.0',

  // Texto que se inyecta en el sticker (se ve al abrirlo en WhatsApp)
  packname: 'Made by',
  author: '@Lyan',

  // Comando principal
  comando: 's2',

  // Sticker animado (solo si el video dura más de 1 s)
  sticker: {
    size: 512,
    fps: 15,
    duracionMax: 6,        // segundos máximos del sticker animado
    duracionEstatica: 0.9, // si dura menos que esto no se anima
    minBytes: 3000,
  },

  stickerEstatico: {
    size: 512,
    duracion: 1,   // 1 fotograma
  },

  // Audio (nota de voz que acompaña al sticker)
  audio: {
    duracionMax: 15, // segundos
    bitrate: '48k',
  },

  // Descargas
  descarga: {
    timeoutMs: 30000,
    maxMB: 30,
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; SM-A125M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },

  // API para bajar videos de TikTok
  tikwm: 'https://api.tikwm.com/',
  tikwmKey: 'null',
};
