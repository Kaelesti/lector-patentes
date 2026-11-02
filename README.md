# Lector de patentes vecinal

PWA que lee placas patentes con la cámara del celular y las coteja con una base de autos reportados por los vecinos (Google Sheets).

**App:** https://kaelesti.github.io/lector-patentes/

## Cómo funciona
- La detección de la placa y la lectura de caracteres ocurren **dentro del teléfono** (ONNX Runtime Web). Las imágenes no se envían a ningún servidor.
- La base se descarga desde un script de Google Apps Script asociado a la planilla, que entrega solo patente, tipo (reporte/prueba), estado y fecha.
- Funciona sin señal: la app, los modelos y la última base descargada quedan guardados en el teléfono.
- En vivo, una patente se confirma cuando se lee igual en al menos 2 cuadros.
- El cotejo distingue tres casos: coincidencia exacta, **posible coincidencia** (caracteres que se confunden: 0/O/D, 8/B, 5/S, 2/Z, 6/G, 1/I/L) y sin reporte.

## Primer uso
1. Abrir la app y tocar ⚙.
2. Pegar la URL del script (termina en `/exec`) y la clave. Quedan guardadas solo en ese teléfono; **no se suben a este repositorio**.
3. Para instalarla: menú del navegador → *Agregar a pantalla de inicio*.

## Uso responsable
Una coincidencia **no** confirma que un auto sea robado. La app nunca indica intervenir: solo verificar en fuente oficial y, si corresponde, llamar al 133. No guarda fotos ni ubicación.

## Estructura
| Archivo | Qué es |
|---|---|
| `index.html`, `app.js` | Interfaz y lógica |
| `sw.js` | Service worker (uso sin señal). Cambiar `VERSION` al publicar cambios |
| `models/` | Detector de placas (YOLOv9-t 384) y OCR de placas (CCT-XS v2 global) |
| `vendor/ort/` | ONNX Runtime Web 1.20.1 |

## Créditos
- Detector: [open-image-models](https://github.com/ankandrew/open-image-models) (MIT)
- OCR: [fast-plate-ocr](https://github.com/ankandrew/fast-plate-ocr) (MIT)
- Motor: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT)
