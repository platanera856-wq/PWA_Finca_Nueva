ACTUALIZACIÓN PWA FINCA — CATÁLOGOS Y ENTREVISTA POR VOZ
========================================================

IMPORTANTE: estos archivos están preparados para el repositorio existente. No borre el repositorio ni cree otro Apps Script. La URL de /exec ya está configurada en js/config.js y fue verificada por el usuario: testConexion respondió exito:true y obtenerDatosFormulario devolvió empleados, labores, insumos y caballones.

ARCHIVOS QUE DEBE SUBIR/REEMPLAZAR en su repositorio PWA_Finca_Nueva:
- index.html
- manifest.webmanifest
- sw.js
- css/app.css
- js/config.js
- js/api.js
- js/db.js
- js/voice.js
- js/camera.js
- js/sync.js
- js/app.js

NO BORRE este archivo que ya debe existir en el repositorio:
- js/html5-qrcode.min.js

Cómo actualizar:
1. Descargue y descomprima el ZIP en el PC.
2. Abra el repositorio GitHub PWA_Finca_Nueva.
3. Reemplace cada archivo indicado en la MISMA ruta. No suba una carpeta envolvente accidental.
4. Mantenga js/html5-qrcode.min.js intacto.
5. Confirme los cambios (Commit changes) en la rama publicada por GitHub Pages (normalmente main / root).
6. Espere a que termine la acción de Pages.
7. Abra la PWA desde el móvil y haga una recarga completa. Si sigue mostrando los archivos antiguos, cierre todas las pestañas de la PWA y vuelva a abrirla; el service worker usa un nombre de caché nuevo.

Qué hace esta actualización:
- Descarga desde Apps Script las listas reales y llena los selectores de trabajador y labor.
- Carga todos los insumos como filas seleccionables y muestra la existencia disponible.
- Lee los QR con la biblioteca local ya existente y busca el código entre los caballones descargados.
- Añade una entrevista por voz tras tocar “Iniciar preguntas por voz”: trabajador, labor, QR, horas, plantas, insumos opcionales y observaciones. Cada pregunta se repite hasta tres veces.
- Guarda primero en IndexedDB y sincroniza cuando hay conexión.
- Requiere GPS porque el backend de Apps Script valida la ubicación como obligatoria.

Limitaciones conocidas:
- El botón de inicio por voz es necesario en muchos móviles porque el navegador bloquea el micrófono y el audio automáticos hasta una interacción de la persona.
- La síntesis de voz puede funcionar sin conexión si Android tiene una voz española instalada; SpeechRecognition del navegador NO garantiza reconocimiento sin internet. Esta entrega no incluye todavía un motor Vosk offline ni su modelo español.
- La integración se ha validado contra el formato de datos visible de Apps Script y se ha revisado sintácticamente, pero debe probarse en el teléfono y verificarse en Sheets antes de producción.
