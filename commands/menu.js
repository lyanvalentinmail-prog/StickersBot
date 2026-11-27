// commands/menu.js — Menú estilo Michi Bot (una instrucción + botones de categoría)
import config from '../config.js';

const P = config.prefijo;

export const MENU_MAIN = 'menu_main';
export const MENU_STICKERS = 'menu_stickers';
export const MENU_HOME = 'menu_home';

const MENU_TXT = `> ⚔️ ${config.botNombre}
 📜 *Elige una categoría para ver los comandos:*

${P}menu main — Comandos principales
${P}menu stickers — Comandos de stickers

> 🍫 ${config.botNombre} ${config.botVersion} | Stickers 🌸`;

const CATEGORIAS = {
  main: {
    texto: `> ⚔️ ${config.botNombre} — Main
 📜 *Comandos principales:*

• ${P}menu — Muestra este menú
• ${P}ping — Verifica que el bot responde
• ${P}owner — Info del creador
• ${P}estado — Estado del bot

> 🍫 ${config.botNombre} ${config.botVersion} | Stickers 🌸`,
  },
  stickers: {
    texto: `> ⚔️ ${config.botNombre} — Stickers
 📜 *Comandos de stickers:*

• ${P}s — Foto/video o link de TikTok → sticker
• ${P}s2 — Video o TikTok → sticker con audio
• ${P}newpack nombre.autor — Crea un paquete de stickers
• ${P}pack done — Envía el paquete creado
• ${P}pack cancel — Cancela el paquete
• ${P}pack audio — Activa/desactiva el audio del paquete
• ${P}searchpack texto — Busca un paquete en Stickerly
• ${P}searchs texto — Busca stickers en Stickerly
• ${P}brat texto — Sticker estilo brat
• ${P}bratv texto — Video brat → sticker

> 🍫 ${config.botNombre} ${config.botVersion} | Stickers 🌸`,
  },
};

const btn = (buttonId, displayText) => ({ buttonId, buttonText: { displayText }, type: 1 });

async function sendWithButtons(sock, msg, { caption, buttons }) {
  const payload = { caption, buttons, headerType: 1 };
  if (config.menuImagen) payload.image = { url: config.menuImagen };
  else payload.text = caption;
  await sock.sendMessage(msg.key.remoteJid, payload, { quoted: msg });
}

/** .menu — una instrucción + botones Main / Stickers */
export async function sendMenu(sock, msg) {
  await sendWithButtons(sock, msg, {
    caption: MENU_TXT,
    buttons: [btn(MENU_MAIN, '📂 Main'), btn(MENU_STICKERS, '🎨 Stickers')],
  });
}

/** .menu main | .menu stickers — lista de comandos de la categoría */
export async function sendCategory(sock, msg, cat) {
  const c = CATEGORIAS[cat];
  if (!c) return sendMenu(sock, msg);
  await sendWithButtons(sock, msg, {
    caption: c.texto,
    buttons: [btn(MENU_HOME, '🏠 Menú')],
  });
}

/** Extrae el id del botón presionado (si el mensaje es una respuesta de botón/lista). */
export function getButtonId(msg) {
  const m = msg.message || {};
  return (
    m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null
  );
}

/** Maneja los botones del menú. Devuelve true si era un botón del menú. */
export async function handleMenuButton(sock, msg, buttonId) {
  if (buttonId === MENU_MAIN) {
    await sendCategory(sock, msg, 'main');
    return true;
  }
  if (buttonId === MENU_STICKERS) {
    await sendCategory(sock, msg, 'stickers');
    return true;
  }
  if (buttonId === MENU_HOME) {
    await sendMenu(sock, msg);
    return true;
  }
  return false;
}
