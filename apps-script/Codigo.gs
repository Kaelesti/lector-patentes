/**
 * Lector de patentes — puente entre la planilla y la app (versión 3: moderación)
 *
 * Consulta pública (doGet): entrega solo patente, nivel de alerta, estado, fechas,
 * placas sustraídas y marca/modelo/color. No entrega observaciones, fuentes, EUN
 * ni quién ingresó o verificó.
 * Moderación (doPost): solo con una clave de moderador de la hoja "Moderadores".
 * Cada cambio queda registrado en la hoja "Historial".
 *
 * INSTALACIÓN / ACTUALIZACIÓN:
 *   1. Escribe tu clave de consulta abajo, en CLAVE (después de ejecutar
 *      "prepararModeracion" queda guardada y en futuras actualizaciones ya no hace falta).
 *   2. Guarda (💾). Ejecuta UNA vez, en este orden, las funciones que aún no hayas ejecutado:
 *      prepararPlanilla → crearFormulario → prepararModeracion
 *   3. Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar.
 */

// Clave de CONSULTA (la que usan todos los vecinos en la app)
const CLAVE = 'cambia-esta-clave';
const CLAVE_EJEMPLO = 'cambia-esta-clave';

// Días que un reporte vecinal SIN verificación oficial sigue alertando.
const DIAS_VIGENCIA_VECINAL = 30;

// ---------------------------------------------------------------------------
// Entrega de datos a la app
// ---------------------------------------------------------------------------
function doGet(e) {
  if (!e || !e.parameter || !claveConsulta() || e.parameter.k !== claveConsulta()) return json({ error: 'no autorizado' });

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
    version: 3,
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
// MODERACIÓN — la app envía POST con {accion, mod (clave del moderador), ...}
// ---------------------------------------------------------------------------
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ error: 'Solicitud inválida' }); }
  const mod = moderador(req && req.mod);
  if (!mod) return json({ error: 'Clave de moderador no válida o inactiva' });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    switch (req.accion) {
      case 'login': return json({ ok: true, nombre: mod });
      case 'verificar': return json(accionVerificar(req, mod));
      case 'nuevo': return json(accionNuevo(req, mod));
      case 'pendientes': return json(accionPendientes());
      case 'avisos': return json(accionAvisos());
      case 'atender': return json(accionAtender(req, mod));
      default: return json({ error: 'Acción desconocida' });
    }
  } catch (err) {
    return json({ error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/** Devuelve el nombre del moderador si la clave es válida y está activa. */
function moderador(clave) {
  clave = texto(clave);
  if (!clave || clave === claveConsulta()) return null;
  const filas = leerTabla(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Moderadores'));
  for (const f of filas) {
    if (texto(f['Clave']) === clave && texto(f['Activo']) === 'Sí') return texto(f['Nombre']) || 'Moderador';
  }
  return null;
}

/** Registra el resultado de una consulta en autoseguro.gob.cl */
function accionVerificar(req, mod) {
  const p = validarPatente(req.patente);
  const r = req.resultado;
  if (['sin', 'placas', 'encargo'].indexOf(r) < 0) throw new Error('Resultado no válido');
  let placas = 'Ninguna';
  if (r === 'placas') {
    if (['Delantera', 'Trasera', 'Ambas'].indexOf(req.placas) < 0) throw new Error('Indica qué placa figura sustraída');
    placas = req.placas;
  } else if (r === 'encargo' && ['Delantera', 'Trasera', 'Ambas'].indexOf(req.placas) >= 0) {
    placas = req.placas;
  }

  const t = tabla('Reportes');
  let i = filaDePatente(t, p);
  let cambios = {
    'Encargo vehículo': r === 'encargo' ? 'Sí' : 'No',
    'Placas sustraídas': placas,
    'Fecha verificación': new Date(),
    'Verificado por': mod,
    'Estado': r === 'sin' ? (req.estado === 'Descartado' ? 'Descartado' : 'Recuperado') : 'Vigente',
  };
  if (texto(req.eun)) cambios['N° EUN'] = texto(req.eun);
  datosVehiculo(req, cambios);

  let accion = 'Verificación';
  if (i < 0) {
    if (r === 'sin') {
      registrarHistorial(mod, 'Verificación', p, 'Sin encargo. La patente no estaba en la base: no se agregó.');
      if (req.aviso) marcarAtendido(req.aviso, mod, 'Verificado: sin encargo');
      return { ok: true, mensaje: p + ' no tiene encargo. No estaba en la base, así que no se agregó.' };
    }
    i = filaNueva(t);
    cambios = Object.assign(filaInicial(t, p, mod, 'Verificación oficial'), cambios); // el resultado manda sobre los valores iniciales
    accion = 'Verificación (registro nuevo)';
  }
  if (texto(req.nota)) cambios['Observaciones'] = agregarNota(valor(t, i, 'Observaciones'), mod, req.nota);

  const detalle = escribir(t, i, cambios);
  registrarHistorial(mod, accion, p, detalle);
  if (req.aviso) marcarAtendido(req.aviso, mod, 'Verificado');
  const txt = { sin: 'sin encargo (' + cambios['Estado'] + ')', placas: 'placas sustraídas (' + placas + ')', encargo: 'encargo vigente' }[r];
  return { ok: true, mensaje: p + ' registrado: ' + txt + '.' };
}

/** Agrega un reporte vecinal nuevo (o reactiva uno recuperado/descartado). */
function accionNuevo(req, mod) {
  const p = validarPatente(req.patente);
  const t = tabla('Reportes');
  let i = filaDePatente(t, p);
  let cambios = {};
  datosVehiculo(req, cambios);
  if (texto(req.sector) && t.col['Sector / Comuna'] !== undefined) cambios['Sector / Comuna'] = texto(req.sector);
  const fr = fechaDesdeTexto(req.fechaRobo); if (fr) cambios['Fecha robo'] = fr;
  if (texto(req.enlace)) cambios['Enlace fuente'] = texto(req.enlace);
  if (texto(req.fuente)) cambios['Fuente'] = texto(req.fuente);

  let accion;
  if (i >= 0) {
    const estado = texto(valor(t, i, 'Estado'));
    if (estado !== 'Recuperado' && estado !== 'Descartado') {
      return { error: p + ' ya está en la base (estado: ' + (estado || 'sin estado') + '). Usa "Registrar verificación" para actualizarla.' };
    }
    Object.assign(cambios, {
      'Estado': 'Por revisar', 'Fecha reporte': new Date(),
      'Encargo vehículo': 'Sin verificar', 'Placas sustraídas': 'Sin verificar',
    });
    accion = 'Reporte reactivado';
  } else {
    i = filaNueva(t);
    cambios = Object.assign(filaInicial(t, p, mod, texto(req.fuente) || 'Redes sociales'), cambios);
    accion = 'Reporte nuevo';
  }
  if (texto(req.nota)) cambios['Observaciones'] = agregarNota(valor(t, i, 'Observaciones'), mod, req.nota);
  const detalle = escribir(t, i, cambios);
  registrarHistorial(mod, accion, p, detalle);
  if (req.aviso) marcarAtendido(req.aviso, mod, accion);
  return { ok: true, mensaje: p + ': ' + accion.toLowerCase() + ' (por revisar).' };
}

/** Reportes que necesitan verificación oficial (o que la tienen hace más de 30 días). */
function accionPendientes() {
  const hoy = new Date(), sin = [], antiguas = [];
  for (const r of leerTabla(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Reportes'))) {
    const p = normalizar(r['Patente']);
    if (!p) continue;
    const estado = texto(r['Estado']);
    if (estado === 'Recuperado' || estado === 'Descartado') continue;
    const enc = texto(r['Encargo vehículo']), pl = texto(r['Placas sustraídas']);
    const item = { p: p, ma: texto(r['Marca']), mo: texto(r['Modelo']), co: texto(r['Color']),
      f: fecha(r['Fecha reporte'] || r['Fecha robo']), fv: fecha(r['Fecha verificación']), e: estado };
    if (!enc || enc === 'Sin verificar' || !pl || pl === 'Sin verificar') { item.motivo = 'Sin verificar'; sin.push(item); }
    else {
      const fv = r['Fecha verificación'];
      if (!(fv instanceof Date) || (hoy - fv) / 86400000 > 30) { item.motivo = 'Verificación antigua'; antiguas.push(item); }
    }
  }
  // Primero los que tienen fecha de reporte más reciente
  sin.sort(function (a, b) { return (b.f || '').localeCompare(a.f || ''); });
  return { ok: true, pendientes: sin.concat(antiguas).slice(0, 300), total: sin.length + antiguas.length };
}

/** Avisos enviados por vecinos (formulario) que aún no se atienden. */
function accionAvisos() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Avisos');
  if (!sh || sh.getLastRow() < 2) return { ok: true, avisos: [] };
  asegurarColumna(sh, 'Atendido');
  const v = sh.getDataRange().getValues(), enc = v[0].map(function (h) { return String(h).trim(); });
  const c = function (prefijo) { for (let k = 0; k < enc.length; k++) if (enc[k].indexOf(prefijo) === 0) return k; return -1; };
  const cP = c('Patente'), cT = c('¿Qué'), cD = c('Detalle'), cE = c('Enlace'), cC = c('¿Cómo'), cA = enc.indexOf('Atendido');
  const avisos = [];
  for (let i = v.length - 1; i >= 1; i--) {
    const f = v[i];
    if (!String(f[0]).trim() || (cA >= 0 && texto(f[cA]))) continue;
    avisos.push({
      fila: i + 1,
      fecha: f[0] instanceof Date ? Utilities.formatDate(f[0], 'America/Santiago', 'dd-MM-yyyy HH:mm') : texto(f[0]),
      p: cP >= 0 ? normalizar(f[cP]) : '', tipo: cT >= 0 ? texto(f[cT]) : '', detalle: cD >= 0 ? texto(f[cD]) : '',
      enlace: cE >= 0 ? texto(f[cE]) : '', contacto: cC >= 0 ? texto(f[cC]) : '',
    });
    if (avisos.length >= 100) break;
  }
  return { ok: true, avisos: avisos };
}

function accionAtender(req, mod) {
  const fila = parseInt(req.fila, 10);
  if (!(fila >= 2)) throw new Error('Aviso no válido');
  marcarAtendido(fila, mod, texto(req.nota) || 'Atendido');
  return { ok: true, mensaje: 'Aviso marcado como atendido.' };
}

function marcarAtendido(fila, mod, nota) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Avisos');
  if (!sh) return;
  const col = asegurarColumna(sh, 'Atendido');
  sh.getRange(fila, col).setValue(seguro('Sí · ' + mod + ' · ' + hoyTexto() + (nota ? ' · ' + nota : '')));
  registrarHistorial(mod, 'Aviso atendido', '', 'Fila ' + fila + (nota ? ' · ' + nota : ''));
}

// ---------------------------------------------------------------------------
// Ejecutar UNA vez: hojas Moderadores e Historial, y guarda la clave de consulta
// ---------------------------------------------------------------------------
function prepararModeracion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  if (CLAVE !== CLAVE_EJEMPLO) props.setProperty('CLAVE', CLAVE);
  if (!claveConsulta()) throw new Error('Primero escribe tu clave de consulta en CLAVE (arriba) y guarda.');

  let m = ss.getSheetByName('Moderadores');
  if (!m) {
    m = ss.insertSheet('Moderadores');
    m.getRange(1, 1, 1, 3).setValues([['Nombre', 'Clave', 'Activo']]).setFontWeight('bold');
    const clave = nuevaClave();
    m.getRange(2, 1, 1, 3).setValues([['José', clave, 'Sí']]);
    m.getRange(2, 3, 199, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).build());
    m.setColumnWidths(1, 3, 160);
    m.getRange(4, 1).setValue('Para agregar un moderador: escribe su nombre, ejecuta la función "nuevaClaveModerador" ' +
      'y copia la clave que aparece en el registro. Para quitarle el acceso: Activo = No.').setFontStyle('italic');
    Logger.log('Tu clave de MODERADOR es: ' + clave + '  (también está en la hoja Moderadores)');
  } else {
    Logger.log('La hoja Moderadores ya existía. Tus claves están ahí.');
  }
  if (!ss.getSheetByName('Historial')) {
    const h = ss.insertSheet('Historial');
    h.getRange(1, 1, 1, 5).setValues([['Fecha y hora', 'Moderador', 'Acción', 'Patente', 'Detalle']]).setFontWeight('bold');
    h.setColumnWidth(1, 140); h.setColumnWidth(5, 500); h.setFrozenRows(1);
  }
  const av = ss.getSheetByName('Avisos');
  if (av) asegurarColumna(av, 'Atendido');
  Logger.log('Moderación lista.');
}

/** Genera una clave nueva para entregar a un moderador (cópiala en la hoja Moderadores). */
function nuevaClaveModerador() {
  Logger.log('Clave nueva: ' + nuevaClave());
}

// ---------------------------------------------------------------------------
// Utilidades de escritura
// ---------------------------------------------------------------------------
function claveConsulta() {
  if (CLAVE && CLAVE !== CLAVE_EJEMPLO) return CLAVE;
  return PropertiesService.getScriptProperties().getProperty('CLAVE') || '';
}

function nuevaClave() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function tabla(nombre) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh) throw new Error('No existe la hoja ' + nombre);
  const v = sh.getDataRange().getValues();
  const enc = v[0].map(function (h) { return String(h).trim(); });
  const col = {};
  enc.forEach(function (h, k) { if (h) col[h] = k; });
  ['Patente', 'Estado', 'Encargo vehículo', 'Placas sustraídas'].forEach(function (h) {
    if (col[h] === undefined) throw new Error('Falta la columna "' + h + '". ¿Ejecutaste prepararPlanilla?');
  });
  return { sh: sh, v: v, col: col };
}

function filaDePatente(t, p) {
  for (let i = 1; i < t.v.length; i++) if (normalizar(t.v[i][t.col['Patente']]) === p) return i;
  return -1;
}

/** Índice (base 0) de la fila siguiente a la última con patente. */
function filaNueva(t) {
  let ultima = 0;
  for (let i = 1; i < t.v.length; i++) if (normalizar(t.v[i][t.col['Patente']])) ultima = i;
  const i = ultima + 1;
  if (i + 1 > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), 50);
  while (t.v.length <= i) t.v.push([]);
  return i;
}

function filaInicial(t, p, mod, fuente) {
  let max = 0;
  for (let i = 1; i < t.v.length; i++) {
    const m = /^R(\d+)$/.exec(texto(t.v[i][t.col['ID']]));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return {
    'ID': 'R' + ('00' + (max + 1)).slice(-3), 'Patente': p, 'Fecha reporte': new Date(), 'Fuente': fuente,
    'Estado': 'Por revisar', 'Encargo vehículo': 'Sin verificar', 'Placas sustraídas': 'Sin verificar', 'Ingresado por': mod,
  };
}

function valor(t, i, h) {
  const c = t.col[h];
  return c === undefined || !t.v[i] ? '' : t.v[i][c];
}

/** Escribe los cambios en la fila i y devuelve un texto "Campo: antes → después; ..." */
function escribir(t, i, cambios) {
  const partes = [];
  Object.keys(cambios).forEach(function (h) {
    const c = t.col[h];
    if (c === undefined) return; // columna inexistente en esta planilla: se ignora
    const antes = valor(t, i, h), despues = cambios[h];
    const a = fecha(antes), d = fecha(despues);
    if (a === d) return;
    t.sh.getRange(i + 1, c + 1).setValue(despues instanceof Date ? despues : seguro(despues));
    if (!t.v[i]) t.v[i] = [];
    t.v[i][c] = despues;
    if (h !== 'Observaciones') partes.push(h + ': ' + (a || '—') + ' → ' + d);
  });
  return partes.join('; ');
}

function datosVehiculo(req, cambios) {
  if (texto(req.ma)) cambios['Marca'] = texto(req.ma);
  if (texto(req.mo)) cambios['Modelo'] = texto(req.mo);
  if (texto(req.co)) cambios['Color'] = texto(req.co);
}

function agregarNota(anterior, mod, nota) {
  const n = hoyTexto() + ' ' + mod + ': ' + texto(nota);
  return texto(anterior) ? texto(anterior) + ' | ' + n : n;
}

function registrarHistorial(mod, accion, p, detalle) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName('Historial');
  if (!h) {
    h = ss.insertSheet('Historial');
    h.getRange(1, 1, 1, 5).setValues([['Fecha y hora', 'Moderador', 'Acción', 'Patente', 'Detalle']]);
  }
  h.appendRow([new Date(), mod, accion, p, seguro(detalle)]);
}

function asegurarColumna(sh, nombre) {
  const enc = encabezados(sh);
  const k = enc.indexOf(nombre);
  if (k >= 0) return k + 1;
  const c = sh.getLastColumn() + 1;
  sh.getRange(1, c).setValue(nombre).setFontWeight('bold');
  return c;
}

function validarPatente(v) {
  const p = normalizar(v);
  if (!/^[A-Z0-9]{5,7}$/.test(p)) throw new Error('Patente no válida: ' + texto(v));
  return p;
}

function fechaDesdeTexto(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(v));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
}

function hoyTexto() { return Utilities.formatDate(new Date(), 'America/Santiago', 'dd-MM-yyyy'); }

/** Evita que un texto escrito en la app se interprete como fórmula. */
function seguro(v) {
  const s = texto(v);
  return /^[=+\-@]/.test(s) ? "'" + s : v;
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
