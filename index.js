// index.js — Vinculación por QR o código de emparejamiento + router de comandos
import * as baileys from '@whiskeysockets/baileys';
import chalk from 'chalk';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import readline from 'readline/promises';
import config from './config.js';
import { checkFfmpeg } from './lib/sticker.js';
import { s2 } from './commands/s2.js';

const SESSION = './session';
const P = config.prefijo;

if (!fs.existsSync(SESSION)) fs.mkdirSync(SESSION, { recursive: true });

// ── Argumentos: node index.js [--qr | --pair 59899...] ─────────────
let pairingNumber = (process.env.PAIRING_NUMBER || '').replace(/\D/g, '') || null;
let forceQR = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if ((a === '--pair' || a === '-p') && argv[i + 1]) {
    pairingNumber = argv[i + 1].replace(/\D/g, '');
    i++;
  } else if (a.startsWith('--pair=')) {
    pairingNumber = a.split('=')[1].replace(/\D/g, '');
  } else if (a === '--qr' || a === '-q') {
    forceQR = true;
  }
}
if (pairingNumber && pairingNumber.length < 8) pairingNumber = null;
let usePairing = !!pairingNumber && !forceQR;

function textoDelMensaje(msg) {
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

async function enrutar(sock, msg, cmd, args) {
  switch (cmd) {
    case config.comando: // s2
    case 'sticker2':
    case 'stickerconaudio':
      return s2(sock, msg, args);

    case 'menu':
    case 'help':
    case 'ayuda':
      return sock.sendMessage(msg.key.remoteJid, {
        text:
          `*${config.botNombre}* 🤖\n\n` +
          `*${P}${config.comando}* → responde a un video/foto, o usa:\n` +
          `*${P}${config.comando}* <enlace de TikTok>\n\n` +
          `Crea el sticker (512×512, sin bordes negros) y te envía el audio.\n\n` +
          `_${config.packname} ${config.author}_`,
      }, { quoted: msg });

    case 'ping': {
      const t = Date.now();
      return sock.sendMessage(msg.key.remoteJid, {
        text: `🏓 Pong! ${Date.now() - t}ms`,
      }, { quoted: msg });
    }

    default:
      return null;
  }
}

async function manejar(sock, msg) {
  if (!msg.message) return;
  if (msg.key.remoteJid === 'status@broadcast') return;
  if (msg.message.protocolMessage) return;
  if (msg.key.fromMe && !msg.message.extendedTextMessage) return;

  const texto = textoDelMensaje(msg);
  if (!texto || !texto.startsWith(P)) return;

  const [cmd, ...args] = texto.slice(P.length).trim().split(/\s+/);
  if (!cmd) return;

  console.log(chalk.blueBright(`[CMD] ${msg.key.remoteJid}: ${texto.slice(0, 60)}`));
  try {
    await enrutar(sock, msg, cmd.toLowerCase(), args);
  } catch (e) {
    console.error(chalk.red('❌ Error en comando:'), e);
  }
}

let codigoPedido = false;   // pedir el código de emparejamiento una sola vez
let avisoQRFallback = false;

async function iniciar() {
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
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr && !usePairing) {
      console.log(chalk.yellow('\n📱 Escanea este QR con WhatsApp → Dispositivos vinculados:\n'));
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'connecting' && usePairing && !state.creds.registered && !codigoPedido) {
      codigoPedido = true;
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(pairingNumber);
          console.log(chalk.greenBright('\n🔑 CÓDIGO DE EMPAREJAMIENTO:'), chalk.yellow.bold(code));
          console.log(chalk.gray('WhatsApp → Dispositivos vinculados → Vincular con número de teléfono\n'));
        } catch (e) {
          console.error(chalk.red('\n❌ No se pudo generar el código:'), e.message);
          if (!avisoQRFallback) {
            avisoQRFallback = true;
            console.log(chalk.yellow('   Asegúrate de tener internet. Si sigue fallando,'));
            console.log(chalk.yellow('   reinicia el bot y elige la opción 1 (código QR).\n'));
          }
        }
      }, 3000);
    }

    if (connection === 'open') {
      console.log(chalk.greenBright('\n✅ ¡Conectado a WhatsApp!'));
      console.log(chalk.gray(`   Comando listo: ${P}${config.comando}\n`));
      state.creds.registered = true;
    }

    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const reconectar = codigo !== baileys.DisconnectReason.loggedOut;
      console.log(chalk.red('❌ Conexión cerrada. Código:'), codigo);
      if (reconectar) {
        console.log(chalk.yellow('🔁 Reconectando en 3s...'));
        setTimeout(iniciar, 3000);
      } else {
        console.log(chalk.redBright('🛑 Sesión cerrada. Borra la carpeta "session" y vuelve a vincular.'));
        process.exit(1);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await manejar(sock, msg);
      } catch (e) {
        console.error(chalk.red('❌ Error al procesar mensaje:'), e);
      }
    }
  });

  return sock;
}

async function main() {
  console.clear();
  console.log(chalk.cyanBright.bold('══════════════════════════════════'));
  console.log(chalk.magentaBright.bold(`   ${config.botNombre} v${config.botVersion}`));
  console.log(chalk.cyanBright.bold('══════════════════════════════════\n'));

  if (!(await checkFfmpeg())) {
    console.log(chalk.yellow('⚠️  ffmpeg no encontrado.'));
    console.log(chalk.yellow('   Termux: pkg install ffmpeg\n'));
  }

  const yaVinculado = fs.existsSync(`${SESSION}/creds.json`);

  // Sin terminal interactivo no podemos preguntar: arrancamos en modo QR
  const hayTerminal = !!process.stdin.isTTY;

  if (!yaVinculado && !pairingNumber && !forceQR && !hayTerminal) {
    console.log(chalk.gray('Sin terminal interactivo: iniciando en modo QR.'));
    console.log(chalk.gray('Para código de emparejamiento usa: node index.js --pair <número>\n'));
    usePairing = false;
  } else if (!yaVinculado && !pairingNumber && !forceQR) {
    console.log(chalk.white('1.') + ' Vincular con *código QR*');
    console.log(chalk.white('2.') + ' Vincular con *código de emparejamiento* (8 dígitos)\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const op = (await rl.question(chalk.yellow('Elige 1 o 2: '))).trim();

    if (op === '2') {
      const num = (await rl.question(
        chalk.yellow('Tu número con código de país (ej: 59899123456): ')
      )).replace(/\D/g, '');
      if (num.length >= 8) {
        pairingNumber = num;
        usePairing = true;
      } else {
        console.log(chalk.red('Número inválido, usando QR.'));
        usePairing = false;
      }
    } else if (op === '1' || op === '') {
      usePairing = false;
    } else {
      console.log(chalk.gray('Opción no reconocida, usando QR.'));
      usePairing = false;
    }
    rl.close();
    console.log('');
  }

  if (yaVinculado) {
    console.log(chalk.gray('Sesión guardada, reconectando...\n'));
  } else if (usePairing) {
    console.log(chalk.gray(`Emparejando el número ${pairingNumber}...\n`));
  } else {
    console.log(chalk.gray('Esperando el QR...\n'));
  }

  await iniciar();
}

main().catch((e) => {
  console.error(chalk.red('Error fatal:'), e);
  process.exit(1);
});
