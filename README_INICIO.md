# PWA Finca — proyecto nuevo desde cero

## Estado de esta entrega
Base inicial nueva. No reutiliza el código anterior. Incluye interfaz de registro, almacenamiento local IndexedDB, caché PWA, prueba de dictado del navegador y apertura controlada de cámara. **Todavía no es producción:** la integración real con Apps Script, el modelo de voz offline y el decodificador QR local requieren configuración e pruebas.

## 1. Publicar gratis con GitHub Pages
1. Descomprima el ZIP en Windows.
2. Inicie sesión en https://github.com y pulse **New repository**.
3. Nombre sugerido: `pwa-finca-registros`. Seleccione **Public** si desea usar Pages gratis y no suba información real o privada.
4. Cree el repositorio. Pulse **Add file → Upload files**.
5. Abra la carpeta descomprimida en el computador y arrastre al navegador el contenido interior (incluidos `index.html`, `sw.js`, `manifest.webmanifest`, `css/` y `js/`), no solo el ZIP.
6. Pulse **Commit changes**.
7. Entre a **Settings → Pages**. En **Build and deployment**, elija **Deploy from a branch**, rama `main`, carpeta `/(root)`, y pulse **Save**.
8. Espere a que aparezca una URL HTTPS similar a `https://USUARIO.github.io/pwa-finca-registros/`.

## 2. Configurar la URL de Apps Script sin modificarlo
1. Abra `js/config.js` en un editor de texto.
2. Reemplace `PEGAR_URL_WEB_APP_GAS_AQUI` por la URL `/exec` del despliegue web que ya utiliza.
3. Mantenga `syncEnabled: false` hasta confirmar el formato de petición y respuesta que acepta el Apps Script. La sincronización está deliberadamente bloqueada para no fingir un envío exitoso ni perder registros.
4. Suba el archivo actualizado a GitHub con **Add file → Upload files** y **Commit changes**.

## 3. Instalar en Android
1. Conecte el teléfono a internet y abra la URL HTTPS en Chrome.
2. En el menú ⋮ elija **Instalar aplicación** o **Añadir a pantalla principal** (puede variar según versión).
3. Abra desde el icono instalado. Visite la app al menos una vez con internet para guardar los recursos en caché.
4. Pruebe modo avión y vuelva a abrir la app. Los registros locales se guardan en IndexedDB.

## 4. Pruebas iniciales
1. Cree un registro de prueba y pulse **Guardar en este teléfono**.
2. Compruebe que aparece en la lista y que permanece después de cerrar y volver a abrir.
3. Active modo avión, abra la app y cree otro registro de prueba.
4. Exporte una copia JSON y guárdela en un lugar seguro.
5. No dé por aprobada la sincronización hasta comprobar que los registros llegan a la hoja de Google Sheets sin duplicados.

## 5. Voz offline: requisito pendiente, no simulado
El botón de dictado usa la API de voz del navegador cuando existe, pero esta puede depender de internet. La voz hablada también depende de las voces instaladas en el teléfono. Para entender español completamente sin internet se debe incluir un motor de reconocimiento local y su modelo de español compatible. No se afirma que esta base ya lo haga.

## 6. Cámara y QR
El botón pide acceso a la cámara por acción del usuario y muestra mensajes de error. El decodificador QR local aún no está incorporado, así que la lectura QR no está terminada. Debe integrarse una biblioteca local y probarse en el teléfono antes de usarla en la finca.

## Seguridad y alcance
No hay contraseñas ni credenciales privadas en estos archivos. Use datos ficticios en las pruebas. El almacenamiento local no sustituye una copia de seguridad. La sincronización y la validación de inventario deben implementarse contra las reglas reales de su Apps Script antes de producción.
