# 🌸 Michi Bot — Stickers

Bot de WhatsApp con [Baileys](https://github.com/WhiskeySockets/Baileys), estilo **Michi Bot**, pensado para correr en **Termux**. Vinculación por **código QR** o **código de vinculación** (8 dígitos).

## 📦 Instalación en Termux

```bash
# 1. Actualiza e instala lo necesario (Node.js + ffmpeg)
pkg update -y
pkg install nodejs ffmpeg git -y

# 2. Clona el repo
git clone https://github.com/lyanvalentinmail-prog/StickersBot.git
cd StickersBot

# 3. Instala las dependencias
npm install

# 4. Inicia el bot
npm start
```

> 💡 Para que el bot no se apague cuando bloqueas el teléfono, usa `termux-wake-lock` en otra sesión de Termux.
> Para que se reinicie solo si se cae: `bash start.sh`

## 🔗 Vincular el bot

Al iniciar por primera vez te pregunta cómo conectar:

```
1. Conectar con código QR
2. Conectar con código de vinculación (8 dígitos)
```

- **QR**: escanea el código desde WhatsApp → *Dispositivos vinculados* → *Vincular un dispositivo*.
- **Código**: ingresa tu número con código de país (ej: `59899123456`, sin `+` ni espacios). El bot muestra un código de 8 dígitos; en WhatsApp ve a *Dispositivos vinculados* → *Vincular con código* e ingrésalo.

También puedes pasar el número directo sin preguntas:

```bash
node index.js --pair 59899123456   # código de vinculación
node index.js --qr                 # código QR
```

La sesión queda guardada en `session/` (no la compartas con nadie).

## 📜 Comandos

Escribe `.menu` y toca un botón para ver las categorías **Main** y **Stickers** (también puedes escribir `.menu main` o `.menu stickers`).

### 📂 Main

| Comando | Descripción |
|---|---|
| `.menu` | Muestra el menú con botones de categoría |
| `.ping` | Verifica que el bot responde |
| `.owner` | Info del creador |
| `.estado` | Estado y tiempo activo del bot |

### 🎨 Stickers

| Comando | Descripción |
|---|---|
| `.s` | Responde a una foto/video o pega un link de TikTok → sticker |
| `.s2` | Video o link de TikTok → sticker con audio (el audio llega como nota de voz) |
| `.newpack nombre.autor` | Crea un paquete de stickers |
| `.pack done` | Envía el paquete creado |
| `.pack cancel` | Cancela el paquete en creación |
| `.pack audio` | Activa/desactiva el audio del paquete |
| `.searchpack texto` | Busca un paquete en Stickerly y lo envía |
| `.searchs texto` | Busca stickers en Stickerly y los envía |
| `.brat texto` | Sticker estilo brat (api.delirius.online) |
| `.bratv texto` | Video brat → sticker (api.delirius.online) |

### 📦 Crear un paquete

```
.newpack Mi Pack.Juan
```
Luego envía las fotos/videos (de a 1 o varias, se agregan solas) y termina con `.pack done` o cancela con `.pack cancel`. Para incluir el audio de los videos: `.newpack nombre.autor audio` o `.pack audio` mientras creas.

### 🔍 Buscar en Stickerly

```
.searchpack patrick   → muestra la lista, responde con un número para enviar el paquete
.searchs patrick      → muestra la lista, responde con un número para enviar los stickers
```

## ⚙️ Configuración

Todo se ajusta en `config.js`: prefijo, nombre del bot, nombre/autor de los stickers, imagen del menú, límites y las APIs de brat.

## 🗂️ Estructura

```
StickersBot/
├── index.js          # conexión (QR/código) y manejo de mensajes
├── config.js         # configuración general
├── commands/
│   ├── menu.js       # menú estilo Michi Bot (botones Main/Stickers)
│   ├── main.js       # comandos principales
│   └── stickers.js   # comandos de stickers
├── lib/
│   ├── sticker.js    # conversión a sticker con ffmpeg + EXIF
│   ├── media.js      # descarga de medios y TikTok
│   ├── stickerly.js  # búsqueda en Stickerly
│   ├── brat.js       # brat / brat video
│   └── store.js      # sesiones temporales
├── session/          # sesión de WhatsApp (se crea sola)
└── tmp/              # archivos temporales
```

## ⚠️ Notas

- **ffmpeg es obligatorio** (convierte fotos/videos a stickers): `pkg install ffmpeg`.
- El bot responde a todos los chats, incluido el tuyo (puedes usarlo desde tu propio teléfono).
- Baileys es una API no oficial: úsalo con responsabilidad, WhatsApp puede limitar el número si se abusa.
