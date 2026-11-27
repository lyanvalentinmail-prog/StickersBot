# 🤖 Sticker Bot — `.s2`

Bot de WhatsApp minimalista para **Termux**: convierte **videos (o enlaces de TikTok) en stickers con audio**.

- 📐 Escala el video a **512×512**
- ✂️ **Elimina los bordes negros** (arriba, abajo y laterales)
- 🎵 Te envía el **audio del video** como nota de voz
- 🏷️ Cada sticker lleva **descripción "Made by"** y **autor "@Lyan"**
- 🔗 Se vincula con **código QR** o **código de emparejamiento**

---

## 📦 Instalación en Termux

```bash
pkg update && pkg upgrade -y
pkg install nodejs ffmpeg git -y
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

**Resultado:** el bot envía el sticker (512×512, sin bordes negros) y luego el audio como nota de voz.

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
| TikTok no descarga | El enlace puede ser privado o regional |
| `Sesión cerrada` | Borra la carpeta `session` y vuelve a vincular |

---

## 📄 Estructura

```
index.js          → conexión (QR / pairing) y router de comandos
config.js         → ajustes (prefijo, texto del sticker, límites)
commands/s2.js    → comando .s2
lib/sticker.js    → ffmpeg: recorte de bordes, sticker WebP, audio, EXIF
lib/media.js      → descargas (adjuntos, enlaces, TikTok)
start.sh          → bucle de reinicio para Termux
```

---

Hecho con ❤️ — **Made by @Lyan**
