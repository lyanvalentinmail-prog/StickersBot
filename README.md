# 🤖 Sticker Bot — `.s2` (stickers CON audio)

Bot de WhatsApp para **Termux**: convierte **videos (o enlaces de TikTok) en stickers con audio nativos**, como los *sound stickers* que WhatsApp lanzó en noviembre de 2026.

- 🔊 **El audio va DENTRO del sticker** (un solo mensaje). El sticker aparece con el icono de altavoz y se escucha al tocarlo.
- 📐 Escala el video a **512×512**
- ✂️ **Elimina los bordes negros** (arriba, abajo y laterales)
- 🏷️ Cada sticker lleva **descripción "Made by"** y **autor "@Lyan"**
- 🔗 Se vincula con **código QR** o **código de emparejamiento**

---

## 📦 Instalación en Termux

```bash
pkg update && pkg upgrade -y
pkg install nodejs-lts ffmpeg git -y
termux-setup-storage      # opcional

git clone https://github.com/lyanvalentinmail-prog/StickersBot.git
cd StickersBot
npm install
```

> ⚠️ **ffmpeg es obligatorio.** Sin él no se pueden crear stickers.

---

## ▶️ Uso

```bash
npm start
```

Al iniciar te pregunta cómo vincular:

```
1. Vincular con *código QR*
2. Vincular con *código de emparejamiento* (8 dígitos)
```

- **Opción 1** → escanea el QR desde *WhatsApp → Dispositivos vinculados → Vincular un dispositivo*.
- **Opción 2** → escribe tu número con código de país (ej. `59899123456`) y WhatsApp te dará un código de 8 dígitos.

También puedes arrancar directo sin el menú:

```bash
node index.js --qr                  # solo QR
node index.js --pair 59899123456    # solo código de emparejamiento
```

La sesión se guarda en `./session`, así que **no hay que vincular de nuevo** cada vez.

Tras `npm install`, el propio bot activa el soporte de stickers con audio
(verás `🔊 Stickers con audio: activados`). Si quieres hacerlo a mano:

```bash
node proto/aplicar-proto.js              # activar
node proto/aplicar-proto.js --restaurar  # volver al proto original
```

Para que se reinicie solo si se cae:

```bash
./start.sh
```

---

## 🎨 Comando `.s2`

**Respondiendo a un video o foto:**

```
.s2
```

**Con un enlace de TikTok:**

```
.s2 https://vm.tiktok.com/XXXXXXX/
```

**Resultado:** el bot envía **un único sticker** (512×512, sin bordes negros) con el audio embebido. Al tocarlo en WhatsApp suena; no llega como nota de voz aparte.

### Otros comandos

| Comando | Qué hace |
|---|---|
| `.menu` | Muestra la ayuda |
| `.ping` | Comprueba que el bot responde |

---

## ⚙️ Configuración (`config.js`)

```js
prefijo: '.',                 // prefijo de los comandos
packname: 'Made by',          // descripción del sticker
author: '@Lyan',              // autor del sticker
sticker: {
  size: 512,                  // tamaño del lienzo
  fps: 15,                    // fluidez del sticker animado
  duracionMax: 6,             // segundos del sticker (WhatsApp permite 10)
},
audio: {
  duracionMax: 15,            // segundos del audio
},
```

Para cambiar el nombre/autor del sticker edita `packname` y `author`.

---

## 🔊 Cómo funciona el sticker con audio

WhatsApp añadió en noviembre de 2026 los *sound stickers*. No es un sticker
normal: viaja en un envoltorio `FutureProofMessage` y el audio va anidado dentro
del propio `StickerMessage`:

```
Message
 └─ 134 audioStickerMessage (FutureProofMessage)
      └─ 1 Message
           └─ 26 StickerMessage (WebP animado 512×512)
                └─ 26 StickerMessage.audioMessage (Ogg/Opus + streamingSidecar)
```

Dos detalles hacen que WhatsApp reproduzca el sonido:

1. **El envoltorio del campo 134** — un sticker suelto con audio dentro no se
   reconoce como sound sticker.
2. **El `streamingSidecar` del audio** — un HMAC-SHA256 truncado a 10 bytes por
   cada bloque de 64 KiB del archivo cifrado, encadenado con los 16 bytes
   anteriores (el IV en el primer bloque).

El formato está contrastado con tres implementaciones en producción:
[coelhobugado/whatsapp-figurinhas-com-som](https://github.com/coelhobugado/whatsapp-figurinhas-com-som),
[raditted/whatsapp-sound-sticker](https://github.com/raditted/whatsapp-sound-sticker)
y el fork [rezzxzx/Baileys](https://github.com/rezzxzx/Baileys).

Baileys 7.0.0-rc14 no tiene ninguno de esos dos campos, así que el bot:

1. Genera el sticker WebP (512×512, sin bordes negros) y le inyecta el EXIF.
2. Extrae hasta **5 s** del audio del video en **OGG/Opus**.
3. Sube ambos medios, calcula el `streamingSidecar` y envía el envoltorio 134.

`proto/aplicar-proto.js` añade los dos campos al proto de Baileys
automáticamente (`postinstall` y al arrancar). Si no pudiera aplicarlo, el bot
envía el sticker y el audio por separado como respaldo, avisando por consola.

> **Nota:** los sound stickers son una función reciente y WhatsApp los despliega
> por cuentas. Si tu versión aún no los muestra, el sticker llegará igualmente
> (sin el icono de sonido) hasta que tu cuenta reciba la función.

## 🧠 Cómo elimina los bordes negros

1. `ffmpeg` analiza el video con el filtro **`cropdetect`** y calcula el área real de imagen.
2. Se recorta ese rectángulo (`crop`).
3. Se escala a 512 px conservando la proporción (`force_original_aspect_ratio=decrease`).
4. Se centra sobre un lienzo cuadrado **transparente** (`pad` con `format=rgba`), nunca negro.

Si el recorte fallara (video rotado o con dimensiones raras), el bot reintenta sin recortar en lugar de fallar.

---

## 🔧 Problemas frecuentes

| Problema | Solución |
|---|---|
| `ffmpeg no encontrado` | `pkg install ffmpeg` |
| `No se pudo generar el código` | Revisa la conexión; si sigue, reinicia y usa QR |
| El sticker sale sin audio | El video original no tenía pista de audio |
| El sticker no muestra el icono de sonido | Tu versión de WhatsApp aún no tiene sound stickers |
| `Stickers con audio no disponibles` al arrancar | Ejecuta `node proto/aplicar-proto.js` |
| TikTok no descarga | El enlace puede ser privado o regional |
| `Sesión cerrada` | Borra la carpeta `session` y vuelve a vincular |

---

## 📄 Estructura

```
index.js          → conexión (QR / pairing) y router de comandos
config.js         → ajustes (prefijo, texto del sticker, límites)
commands/s2.js    → comando .s2
lib/sticker.js    → ffmpeg: recorte de bordes, sticker WebP, audio, EXIF
lib/soundsticker.js → sound sticker: envoltorio 134 + streamingSidecar
lib/media.js      → descargas (adjuntos, enlaces, TikTok)
proto/aplicar-proto.js → activa StickerMessage.audioMessage en Baileys
start.sh          → bucle de reinicio para Termux
```

---

Hecho con ❤️ — **Made by @Lyan**
