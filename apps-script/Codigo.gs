/**
 * Lector de patentes — puente entre la planilla y la app (versión 2)
 *
 * Qué entrega a la app: solo patente, nivel de alerta, estado, fechas,
 * placas sustraídas y marca/modelo/color (para comparar en terreno).
 * No entrega observaciones, fuentes, EUN ni quién ingresó o verificó.
 *
 * INSTALACIÓN (una sola vez):
 *   1. Escribe tu clave abajo, en CLAVE.
 *   2. Guarda (💾). Arriba, elige la función "prepararPlanilla" y toca ▶ Ejecutar.
 *   3. Luego elige "crearFormulario" y toca ▶ Ejecutar.
 *   4. Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar.
 */

// ⚠ ESCRIBE AQUÍ TU CLAVE (la misma que ya usas en la app)
const CLAVE = 'cambia-esta-clave';

// Días que un reporte vecinal SIN verificación oficial sigue alertando.
const DIAS_VIGENCIA_VECINAL = 30;

// ---------------------------------------------------------------------------
// Entrega de datos a la app
// ---------------------------------------------------------------------------
function doGet(e) {
  if (!e || !e.parameter || e.parameter.k !== CLAVE) return json({ error: 'no autorizado' });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoy = new Date();
  const salida = [];

  const rep = leerTabla(ss.getSheetByName('Reportes'));
  for (const r of rep) {
    const p = normalizar(r['Patente']);
    if (!p) continue;
    const estado = texto(r['Estado']);
    if (estado === 'Recuperado' || estado === 'Descartado') continue;

    const encargo = texto(r['Encargo vehículo'] !== undefined ? r['Encargo vehículo'] : r['Encargo oficial']);
    const placas = texto(r['Placas sustraídas']) || 'Sin verificar';
    const placaSustraida = ['Delantera', 'Trasera', 'Ambas'].indexOf(placas) >= 0;
    const fechaRep = r['Fecha reporte'] || r['Fecha robo'];

    let nivel;
    if (encargo === 'Sí') nivel = 'encargo';
    else if (placaSustraida) nivel = 'placa';
    else if (encargo === 'No' && placas === 'Ninguna') continue; // verificado sin encargo: no alerta
    else {
      // Reporte vecinal sin verificación oficial: vence a los DIAS_VIGENCIA_VECINAL días
      if (fechaRep instanceof Date && (hoy - fechaRep) / 86400000 > DIAS_VIGENCIA_VECINAL) continue;
      nivel = 'vecinal';
    }

    const reg = { p: p, n: nivel, e: estado, f: fecha(fechaRep), fv: fecha(r['Fecha verificación']) };
    if (placaSustraida) reg.ps = placas;
    const ma = texto(r['Marca']), mo = texto(r['Modelo']), co = texto(r['Color']);
    if (ma) reg.ma = ma; if (mo) reg.mo = mo; if (co) reg.co = co;
    if (nivel === 'vecinal' && !(fechaRep instanceof Date)) reg.sf = 1; // sin fecha: reporte antiguo
    salida.push(reg);
  }

  const pru = leerTabla(ss.getSheetByName('Pruebas'));
  for (const r of pru) {
    const p = normalizar(r['Patente']);
    if (!p || texto(r['Activa']) !== 'Sí') continue;
    salida.push({ p: p, n: 'prueba' });
  }

  const props = PropertiesService.getScriptProperties();
  return json({
    version: 2,
    actualizado: new Date().toISOString(),
    vigenciaVecinal: DIAS_VIGENCIA_VECINAL,
    formulario: props.getProperty('FORM_URL') || '',
    total: salida.length,
    patentes: salida,
  });
}

// ---------------------------------------------------------------------------
// Ejecutar UNA vez: agrega las columnas nuevas a la hoja Reportes
// ---------------------------------------------------------------------------
function prepararPlanilla() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Reportes');
  const maxFilas = sh.getMaxRows();
  let enc = encabezados(sh);

  if (enc.indexOf('Encargo vehículo') >= 0) {
    Logger.log('La planilla ya estaba preparada. No se hizo nada.');
    return;
  }
  const colEnc = enc.indexOf('Encargo oficial') + 1;
  if (colEnc < 1) throw new Error('No encontré la columna "Encargo oficial" en Reportes.');

  // 1) Renombrar "Encargo oficial" → "Encargo vehículo"
  sh.getRange(1, colEnc).setValue('Encargo vehículo');

  // 2) Insertar "Placas sustraídas" y "N° EUN" a continuación
  sh.insertColumnsAfter(colEnc, 2);
  sh.getRange(1, colEnc + 1, 1, 2).setValues([['Placas sustraídas', 'N° EUN']]);

  // 3) Insertar "Verificado por" después de "Fecha verificación"
  enc = encabezados(sh);
  const colFv = enc.indexOf('Fecha verificación') + 1;
  sh.insertColumnsAfter(colFv, 1);
  sh.getRange(1, colFv + 1).setValue('Verificado por');

  // 4) Formato de encabezados y validaciones
  const formatoEnc = sh.getRange(1, colEnc);
  [colEnc + 1, colEnc + 2, colFv + 1].forEach(function (c) {
    formatoEnc.copyFormatToRange(sh, c, c, 1, 1);
    sh.setColumnWidth(c, 130);
  });
  const lista = function (vals) {
    return SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(false).build();
  };
  sh.getRange(2, colEnc, maxFilas - 1, 1).setDataValidation(lista(['Sin verificar', 'Sí', 'No']));
  sh.getRange(2, colEnc + 1, maxFilas - 1, 1).setDataValidation(lista(['Sin verificar', 'Ninguna', 'Delantera', 'Trasera', 'Ambas']));
  sh.getRange(2, colEnc + 2, maxFilas - 1, 1).setDataValidation(null);
  sh.getRange(2, colFv + 1, maxFilas - 1, 1).setDataValidation(null);

  // 5) "Sin verificar" en Placas sustraídas para los registros existentes
  const colPat = encabezados(sh).indexOf('Patente') + 1;
  const pats = sh.getRange(2, colPat, maxFilas - 1, 1).getValues();
  const valores = pats.map(function (f) { return [String(f[0]).trim() ? 'Sin verificar' : '']; });
  sh.getRange(2, colEnc + 1, maxFilas - 1, 1).setValues(valores);

  // 6) Actualizar la hoja Léeme
  actualizarLeeme(ss);
  Logger.log('Listo: columnas nuevas agregadas en Reportes.');
}

function actualizarLeeme(ss) {
  const l = ss.getSheetByName('Léeme');
  if (!l) return;
  const a = l.getRange(1, 1, l.getLastRow(), 1).getValues().map(function (f) { return String(f[0]); });
  const fila = a.indexOf('Encargo oficial') + 1;
  if (fila > 0) {
    l.getRange(fila, 1, 1, 2).setValues([['Verificación oficial',
      'Consultar la patente en autoseguro.gob.cl y anotar: Encargo vehículo (Sí/No), Placas sustraídas ' +
      '(Ninguna/Delantera/Trasera/Ambas), N° EUN, Fecha verificación y Verificado por. ' +
      'Lo oficial manda: con encargo = alerta roja; solo placas sustraídas = alerta morada (comparar marca, modelo y color); ' +
      'sin encargo ni placas sustraídas = no alerta.']]);
    l.insertRowAfter(fila);
    l.getRange(fila + 1, 1, 1, 2).setValues([['Vigencia',
      'Un reporte vecinal sin verificación oficial deja de alertar ' + DIAS_VIGENCIA_VECINAL +
      ' días después de su Fecha reporte. Los reportes sin fecha siguen alertando como "antiguos": conviene verificarlos.']]);
    l.getRange(fila, 1, 2, 2).setFontFamily('Arial').setFontSize(10).setWrap(true).setVerticalAlignment('top');
    l.getRange(fila, 1, 2, 1).setFontWeight('bold');
  }
}

// ---------------------------------------------------------------------------
// Ejecutar UNA vez: crea el formulario "Informar un cambio" (respuestas → hoja Avisos)
// ---------------------------------------------------------------------------
function crearFormulario() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FORM_URL')) {
    Logger.log('El formulario ya existe: ' + props.getProperty('FORM_URL'));
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const form = FormApp.create('Lector de patentes – Informar un cambio');
  form.setDescription(
    'Avisa a los moderadores de un cambio sobre una patente: auto recuperado, reporte nuevo o un dato incorrecto. ' +
    'Un moderador lo verificará en fuente oficial antes de modificar la base. ' +
    'No incluyas nombres, teléfonos ni direcciones de los dueños.');
  form.setCollectEmail(false);

  const itPat = form.addTextItem().setTitle('Patente').setHelpText('Ej: ABCD12, sin guiones').setRequired(true);
  form.addMultipleChoiceItem().setTitle('¿Qué quieres informar?').setRequired(true).setChoiceValues([
    'El auto fue recuperado / ya apareció',
    'Reporte nuevo de auto robado',
    'Placas robadas',
    'Un dato está incorrecto',
    'Otro',
  ]);
  form.addParagraphTextItem().setTitle('Detalle').setHelpText('Marca, modelo, color, fecha, sector… lo que sepas.');
  form.addTextItem().setTitle('Enlace a la publicación o evidencia (opcional)');
  form.addTextItem().setTitle('¿Cómo te contactamos si hay dudas? (opcional)')
    .setHelpText('Solo lo verán los moderadores.');

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();

  // Renombrar la hoja de respuestas a "Avisos"
  try {
    ss.getSheets().forEach(function (s) {
      const f = s.getFormUrl && s.getFormUrl();
      if (f && f.indexOf(form.getId()) >= 0 && !ss.getSheetByName('Avisos')) s.setName('Avisos');
    });
  } catch (err) { Logger.log('No se pudo renombrar la hoja de respuestas: ' + err); }

  // Enlace con la patente precargada (la app reemplaza PATENTE por la patente leída)
  const pre = form.createResponse().withItemResponse(itPat.createResponse('PATENTE')).toPrefilledUrl();
  props.setProperty('FORM_URL', pre);
  Logger.log('Formulario creado. Enlace para responder: ' + form.getPublishedUrl());
  Logger.log('Para editarlo: ' + form.getEditUrl());
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function encabezados(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
}

function leerTabla(sh) {
  if (!sh) return [];
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  const enc = v[0].map(function (h) { return String(h).trim(); });
  return v.slice(1).map(function (fila) {
    const o = {};
    enc.forEach(function (h, i) { if (h) o[h] = fila[i]; });
    return o;
  });
}

function normalizar(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function texto(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function fecha(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Santiago', 'yyyy-MM-dd');
  return texto(v);
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
