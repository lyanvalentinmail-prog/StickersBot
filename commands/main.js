// commands/main.js — Comandos principales (Main)
import config from '../config.js';

const inicio = Date.now();

export async function ping(sock, msg) {
  const t0 = performance.now();
  await sock.sendMessage(msg.key.remoteJid, { text: '🏓 *Pong!*' }, { quoted: msg });
  const ms = Math.max(1, Math.floor(performance.now() - t0));
  await sock.sendMessage(msg.key.remoteJid, { text: `⚔️ *Latencia:* ${ms}ms` }, { quoted: msg });
}

export async function owner(sock, msg) {
  await sock.sendMessage(
    msg.key.remoteJid,
    {
      text: `👤 *Creador:* ${config.owner}\n🤖 *Bot:* ${config.botNombre} v${config.botVersion}\n🌸 Hecho con Baileys`,
    },
    { quoted: msg }
  );
}

export async function estado(sock, msg) {
  const up = Math.floor((Date.now() - inicio) / 1000);
  const h = Math.floor(up / 3600);
  const m = Math.floor((up % 3600) / 60);
  const s = up % 60;
  await sock.sendMessage(
    msg.key.remoteJid,
    {
      text: `🤖 *${config.botNombre} v${config.botVersion}*\n⏱️ *Activo hace:* ${h}h ${m}m ${s}s\n🟢 *Estado:* Conectado`,
    },
    { quoted: msg }
  );
}
