// config.js — Configuración general del bot
export default {
  // Prefijo de comandos (ej: . ! # /)
  prefijo: '.',

  // Nombre y versión del bot (se muestran en el menú y la consola)
  botNombre: 'Michi Bot',
  botVersion: '1.0.0',

  // Nombre/autor por defecto de los stickers
  packname: 'Michi Bot 🌸',
  autor: 'by Michi',

  // Dueño del bot (comando .owner)
  owner: 'Tu Nombre',

  // Imagen del menú (URL). Puedes cambiarla por la tuya.
  menuImagen: 'https://raw.githubusercontent.com/Ado926/WirksiBoxFiles/main/1749661095010-fyrz5r-1749661072633-fd9d32.jpg',

  // Límites de stickers
  sticker: {
    maxSegundos: 8, // duración máxima de video → sticker animado
    fps: 12, // fotogramas por segundo del sticker animado
    maxPack: 30, // stickers máximos por paquete
    maxAudioSeg: 10, // duración máxima del audio en .s2
  },

  // APIs de brat (se prueban en orden hasta que una responda)
  apis: {
    brat: [
      'https://api.delirius.online/canvas/brat?text=',
      'https://api.ryzendesu.vip/api/tools/brat?text=',
      'https://api.siputzx.my.id/api/tools/brat?text=',
    ],
    bratv: [
      'https://api.delirius.online/canvas/bratvideo?text=',
      'https://api.delirius.online/canvas/bratvid?text=',
      'https://api.ryzendesu.vip/api/tools/bratvid?text=',
      'https://api.siputzx.my.id/api/tools/bratvid?text=',
    ],
  },

  // User-Agent para la API de Stickerly
  stickerlyUA: 'androidapp.stickerly/3.31.0 (M2006C3LG; U; Android 29; in-ID; id;)',
};
