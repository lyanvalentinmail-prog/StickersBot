// index.js — Michi Bot: conexión a WhatsApp con Baileys (QR o código de vinculación)
import * as baileys from '@whiskeysockets/baileys';
import chalk from 'chalk';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import readline from 'readline/promises';
import config from './config.js';
import { checkFfmpeg } from './lib/sticker.js';
import { sendMenu, sendCategory, getButtonId, handleMenuButton } from './commands/menu.js';
import { ping, owner, estado } from './commands/main.js';
import {
  s, s2, newpack, pack, searchpack, searchs, brat, bratv, tryAddToPack, tryHandleSearchPick,
} from './commands/stickers.js';

const SESSION = './session';
const P = config.prefijo;

if (!fs.existsSync(SESSION)) fs.mkdirSync(SESSION, { recursive: true });

// ── Argumentos: node index.js [--pair 59899123456 | --qr] ──────────
let pairingNumber = process.env.PAIRING_NUMBER || null;
let forceQR = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--pair' && argv[i + 1]) pairingNumber = argv[i + 1].replace(/\D/g, '');
  if (argv[i] === '--qr') forceQR = true;
}
let usePairing = !!pairingNumber;

function extractText(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  );
}

async function routeCommand(sock, msg, cmd, args) {
  switch (cmd) {
    case 'menu':
    case 'ayuda':
    case 'help': {
      const cat = (args[0] || '').toLowerCase();
      if (cat === 'main' || cat === 'stickers') return sendCategory(sock, msg, cat);
      return sendMenu(sock, msg);
    }
    case 'ping':
      return ping(sock, msg);
    case 'owner':
      return owner(sock, msg);
    case 'estado':
      return estado(sock, msg);
    case 's':
    case 'sticker':
      return s(sock, msg, args);
    case 's2':
      return s2(sock, msg, args);
    case 'newpack':
      return newpack(sock, msg, args);
    case 'pack':
      return pack(sock, msg, args);
    case 'searchpack':
      return searchpack(sock, msg, args);
    case 'searchs':
      return searchs(sock, msg, args);
    case 'brat':
      return brat(sock, msg, args);
    case 'bratv':
    case 'bratvid':
      return bratv(sock, msg, args);
    default:
      return;
  }
}

async function handleMessage(sock, msg) {
  if (!msg.message) return;
  if (msg.key.remoteJid === 'status@broadcast') return;
  if (msg.message.protocolMessage) return;

  const text = extractText(msg);

  // Botones del menú
  const buttonId = getButtonId(msg);
  if (buttonId && (await handleMenuButton(sock, msg, buttonId))) return;

  // Paquete en creación: las fotos/videos se agregan solas
  if (await tryAddToPack(sock, msg)) return;

  // Búsqueda de Stickerly: respuesta con un número
  if (text && (await tryHandleSearchPick(sock, msg, text))) return;

  // Comandos
  if (!text.startsWith(P)) return;
  const [cmd, ...args] = text.slice(P.length).trim().split(/\s+/);
  if (!cmd) return;
  console.log(chalk.blueBright(`[MSG] ${msg.key.remoteJid}: ${text}`));
  try {
    await routeCommand(sock, msg, cmd.toLowerCase(), args);
  } catch (e) {
    console.error(chalk.red('❌ Error en comando:'), e);
    await sock
      .sendMessage(msg.key.remoteJid, { text: '⚠️ Error ejecutando el comando.' }, { quoted: msg })
      .catch(() => {});
  }
}

async function startBot() {
  const { state, saveCreds } = await baileys.useMultiFileAuthState(SESSION);
  const { version } = await baileys.fetchLatestBaileysVersion();

  const sock = baileys.makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: {
      creds: state.creds,
      keys: baileys.makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    browser: ['Ubuntu', 'Chrome', '108.0.5359.125'],
  });

  sock.ev.on('creds.update', saveCreds);

  let codeRequested = false;
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && !usePairing) {
      console.log(chalk.yellow('📱 Escanea este QR con WhatsApp (Dispositivos vinculados):'));
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log(chalk.greenBright('✅ ¡Conectado correctamente!'));
    }
    if (connection === 'connecting' && usePairing && !state.creds.registered && !codeRequested) {
      codeRequested = true;
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(pairingNumber);
          console.log(chalk.yellow('🔑 Código de vinculación (8 dígitos):'), chalk.greenBright.bold(code));
          console.log(chalk.gray('WhatsApp > Dispositivos vinculados > Vincular con código'));
        } catch (e) {
          console.error(chalk.red('Error al generar el código:'), e.message);
        }
      }, 2500);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconectar = code !== baileys.DisconnectReason.loggedOut;
      console.log(chalk.red('❌ Conexión cerrada. Código:'), code);
      if (reconectar) {
        console.log(chalk.yellow('🔁 Reconectando en 3s...'));
        setTimeout(startBot, 3000);
      } else {
        console.log(chalk.redBright('🛑 Sesión cerrada. Borra la carpeta "session" y vuelve a vincular.'));
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (e) {
        console.error(chalk.red('❌ Error al procesar mensaje:'), e);
      }
    }
  });
}

async function main() {
  console.clear();
  console.log(chalk.cyanBright.bold('══════════════════════════════'));
  console.log(chalk.magentaBright.bold(`       ${config.botNombre} v${config.botVersion}`));
  console.log(chalk.cyanBright.bold('══════════════════════════════'));

  if (!checkFfmpeg()) {
    console.log(chalk.yellow('⚠️  ffmpeg no encontrado. Instálalo con: pkg install ffmpeg'));
  }

  const credsPath = `${SESSION}/creds.json`;
  if (!fs.existsSync(credsPath) && !pairingNumber && !forceQR) {
    console.log(chalk.green('1.') + ' Conectar con código QR');
    console.log(chalk.green('2.') + ' Conectar con código de vinculación (8 dígitos)');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const opcion = (await rl.question(chalk.yellow('Elige una opción (1 o 2): '))).trim();
    if (opcion === '2') {
      pairingNumber = (
        await rl.question(chalk.yellow('Ingresa tu número con código de país (ej: 59899123456): '))
      ).replace(/\D/g, '');
      usePairing = !!pairingNumber;
    }
    rl.close();
  }

  await startBot();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
