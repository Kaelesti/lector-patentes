# Lector de patentes vecinal

PWA que lee placas patentes con la cámara del celular y las coteja con una base de autos reportados por los vecinos (Google Sheets).

**App:** https://kaelesti.github.io/lector-patentes/

## Cómo funciona
- La detección de la placa y la lectura de caracteres ocurren **dentro del teléfono** (ONNX Runtime Web). Las imágenes no se envían a ningún servidor.
- La base se descarga desde un script de Google Apps Script asociado a la planilla, que entrega solo patente, nivel de alerta, estado, fechas, placas sustraídas y marca/modelo/color, y solo a cuentas habilitadas.
- Funciona sin señal: la app, los modelos y la última base descargada quedan guardados en el teléfono.
- En vivo, una patente se confirma cuando se lee igual en al menos 2 cuadros.
- Niveles de resultado:
  - 🔴 **Encargo oficial** del vehículo (verificado en autoseguro.gob.cl).
  - 🟣 **Placa sustraída** (oficial): el vehículo original no tiene encargo, pero sus placas sí. Se muestran marca, modelo y color para comparar en terreno.
  - 🟠 **Reporte vecinal** sin verificar. Deja de alertar a los 30 días de su fecha de reporte.
  - Posible coincidencia (caracteres que se confunden: 0/O/D, 8/B, 5/S, 2/Z, 6/G, 1/I/L), prueba y sin reporte.
- Lo oficial manda: un registro verificado sin encargo ni placas sustraídas deja de alertar, y uno marcado Recuperado o Descartado también.
- Cada resultado muestra una **línea de confianza** según la fuente (oficial o vecinal) y su antigüedad.
- **Informar un cambio** abre un Formulario de Google con la patente precargada; las respuestas llegan a la hoja *Avisos* y solo los moderadores modifican la base.

## Cuentas por invitación
- Roles: **Vecino → Enlace → Moderador → Administrador**. Sin contraseñas ni datos personales: cada cuenta tiene un ID interno y un **nick**.
- Se entra con un **enlace de invitación** de un solo uso que vence a las 48 horas. Al aceptarlo, el teléfono queda vinculado (el servidor guarda solo una huella del token).
- Cambio de teléfono: un moderador genera un enlace de *nuevo teléfono*; el anterior deja de funcionar.
- Estados: Pendiente · Aceptada · Habilitada · En análisis · Rechazada / Vencida / Revocada / Anulada.
- **No se registra qué patentes consulta cada persona.** Solo las acciones administrativas quedan en *Historial*.
- Instalación: ejecutar `prepararCuentas` en Apps Script; entrega el código de la cuenta de Administrador.

## Moderación
- Visible solo para Moderadores y Administrador. Panel 🛡: **Pendientes**, **Avisos**, **Nuevo** reporte y **Usuarios** (invitar, reenviar o anular invitaciones, nuevo teléfono, En análisis, revocar).
- **Registrar verificación** en cada resultado: se abre Autoseguro con la patente copiada y se registra el aviso que mostró (🔵 sin encargo · 🟡 placas sustraídas · 🔴 encargo vigente).
- Un moderador no puede gestionar cuentas de su mismo rango o superior; solo el Administrador invita moderadores.

## Primer uso
1. Abrir el enlace de invitación recibido (o pegar el enlace/código en ⚙ → Mi cuenta).
2. Elegir un nick y aceptar las condiciones de uso.
3. Para instalarla: menú del navegador → *Agregar a pantalla de inicio*.

## Uso responsable
Una coincidencia **no** confirma que un auto sea robado. La app nunca indica intervenir: solo verificar en fuente oficial y, si corresponde, llamar al 133. No guarda fotos ni ubicación.

## Estructura
| Archivo | Qué es |
|---|---|
| `index.html`, `app.js` | Interfaz, lectura y cotejo |
| `cuenta.js`, `moderacion.js` | Cuentas por invitación y módulo de moderación |
| `config.js` | URL del servidor (no es secreta) |
| `apps-script/Codigo.gs` | Script de Google Apps Script que va dentro de la planilla |
| `sw.js` | Service worker (uso sin señal). Cambiar `VERSION` al publicar cambios |
| `models/` | Detector de placas (YOLOv9-t 384) y OCR de placas (CCT-XS v2 global) |
| `vendor/ort/` | ONNX Runtime Web 1.20.1 |

## Créditos
- Detector: [open-image-models](https://github.com/ankandrew/open-image-models) (MIT)
- OCR: [fast-plate-ocr](https://github.com/ankandrew/fast-plate-ocr) (MIT)
- Motor: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT)
