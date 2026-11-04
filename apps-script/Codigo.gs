/**
 * Lector de patentes — puente entre la planilla y la app (versión 4: cuentas por invitación)
 *
 * - Cada persona tiene su cuenta (ID + nick, sin nombres ni contraseñas). Se entra con un
 *   enlace de invitación de un solo uso que vence a las 48 horas; el teléfono queda vinculado.
 * - Roles: Vecino → Enlace → Moderador → Administrador.
 * - La base solo se entrega a cuentas habilitadas. NO se registra qué patentes consulta cada persona.
 * - Cada acción administrativa queda en la hoja "Historial".
 *
 * INSTALACIÓN / ACTUALIZACIÓN:
 *   1. Guarda (💾). Ejecuta UNA vez las funciones que aún no hayas ejecutado:
 *      prepararPlanilla → crearFormulario → prepararCuentas
 *   2. prepararCuentas muestra en el registro tu CÓDIGO DE ADMINISTRADOR (vence en 48 h).
 *      Si se te pasa el plazo, ejecuta "codigoAdministrador" para generar otro.
 *   3. Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar.
 */

// Días que un reporte vecinal SIN verificación oficial sigue alertando.
const DIAS_VIGENCIA_VECINAL = 30;
// Horas de validez de un enlace de invitación.
const HORAS_INVITACION = 48;
// true = los vecinos invitados por un Enlace también necesitan aprobación de un moderador.
const APROBACION_MODERADOR_VECINOS = false;

const ROLES = ['Vecino', 'Enlace', 'Moderador', 'Administrador'];
const rango = function (rol) { return ROLES.indexOf(rol); };

// ---------------------------------------------------------------------------
// La versión anterior entregaba la base por GET con una clave compartida. Ya no.
// ---------------------------------------------------------------------------
function doGet(e) {
  return json({ error: 'Esta versión funciona con cuentas por invitación. Actualiza la app.' });
}

/** Base de patentes para la app (solo cuentas habilitadas). */
function construirBase() {
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
  return {
    ok: true,
    version: 4,
    actualizado: new Date().toISOString(),
    vigenciaVecinal: DIAS_VIGENCIA_VECINAL,
    formulario: props.getProperty('FORM_URL') || '',
    total: salida.length,
    patentes: salida,
  };
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
// TODA la comunicación con la app: POST con {accion, token, ...}
// ---------------------------------------------------------------------------
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ error: 'Solicitud inválida' }); }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    // Acciones con código de invitación (aún sin sesión)
    if (req.accion === 'invitacion') return json(accionVerInvitacion(req));
    if (req.accion === 'aceptar') return json(accionAceptar(req));
    if (req.accion === 'rechazar') return json(accionRechazar(req));

    const u = usuarioDeToken(req.token);
    if (!u) return json({ error: 'Este teléfono no tiene una cuenta válida. Pide un enlace nuevo a quien te invitó.', sesion: 'invalida' });
    if (u.estado !== 'Habilitada') {
      const msj = { 'Aceptada': 'Tu cuenta está esperando la aprobación de un moderador.',
        'En análisis': 'Tu cuenta está en revisión. Consulta con quien te invitó.',
        'Revocada': 'Tu acceso fue revocado.' }[u.estado] || 'Tu cuenta no está habilitada.';
      return json({ error: msj, sesion: u.estado, perfil: perfilPublico(u) });
    }
    const actor = u.nick;
    switch (req.accion) {
      case 'perfil': return json({ ok: true, perfil: perfilPublico(u) });
      case 'base': { const b = construirBase(); b.perfil = perfilPublico(u); return json(b); }
    }
    // Desde aquí, solo moderadores y administrador
    exigirRol(u, 'Moderador');
    switch (req.accion) {
      case 'verificar': return json(accionVerificar(req, actor));
      case 'nuevo': return json(accionNuevo(req, actor));
      case 'pendientes': return json(accionPendientes());
      case 'avisos': return json(accionAvisos());
      case 'atender': return json(accionAtender(req, actor));
      case 'invitar': return json(accionInvitar(req, u));
      case 'nuevoTelefono': return json(accionNuevoTelefono(req, u));
      case 'usuarios': return json(accionUsuarios(u));
      case 'estadoUsuario': return json(accionEstadoUsuario(req, u));
      case 'anularInvitacion': return json(accionAnularInvitacion(req, u));
      default: return json({ error: 'Acción desconocida' });
    }
  } catch (err) {
    return json({ error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function exigirRol(u, minimo) {
  if (rango(u.rol) < rango(minimo)) throw new Error('Tu cuenta no tiene permiso para esta acción.');
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
// CUENTAS E INVITACIONES
// Usuarios:     ID | Nick | Rol | Estado | Invitado por | Fecha alta | Token | Notas
// Invitaciones: Código | Tipo | Rol | Usuario | Referencia | Creada | Vence | Creada por | Estado
// ---------------------------------------------------------------------------
const COL_USUARIOS = ['ID', 'Nick', 'Rol', 'Estado', 'Invitado por', 'Fecha alta', 'Token', 'Notas'];
const COL_INVITACIONES = ['Código', 'Tipo', 'Rol', 'Usuario', 'Referencia', 'Creada', 'Vence', 'Creada por', 'Estado'];

/** Ejecutar UNA vez: crea las hojas de cuentas y el código del administrador. */
function prepararCuentas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  hojaCon('Usuarios', COL_USUARIOS);
  hojaCon('Invitaciones', COL_INVITACIONES);
  if (!ss.getSheetByName('Historial')) hojaCon('Historial', ['Fecha y hora', 'Quién', 'Acción', 'Patente', 'Detalle']);
  const admin = tablaSimple('Usuarios').filas.some(function (f) { return f['Rol'] === 'Administrador' && f['Estado'] === 'Habilitada'; });
  if (admin) { Logger.log('Ya existe un administrador habilitado. No se generó código.'); return; }
  codigoAdministrador();
  if (ss.getSheetByName('Moderadores')) Logger.log('La hoja "Moderadores" ya no se usa: puedes borrarla.');
}

/** Genera un código de invitación para la cuenta de Administrador (úsalo si se venció el anterior). */
function codigoAdministrador() {
  const inv = crearInvitacion('Nueva cuenta', 'Administrador', '', 'Administrador (instalación)', 'Instalación');
  Logger.log('TU CÓDIGO DE ADMINISTRADOR: ' + inv.codigo);
  Logger.log('En la app: ⚙ → "Tengo una invitación" → pega el código. Vence en ' + HORAS_INVITACION + ' horas.');
}

function accionVerInvitacion(req) {
  const t = tablaSimple('Invitaciones'), k = filaInvitacion(t, req.codigo);
  if (k < 0) return { error: 'La invitación no existe. Revisa el enlace.' };
  const inv = t.filas[k], est = estadoInvitacion(t, k);
  if (est !== 'Pendiente') return { error: mensajeInvitacion(est) };
  return { ok: true, tipo: inv['Tipo'], rol: inv['Rol'], vence: iso(inv['Vence']),
    nick: inv['Tipo'] === 'Nuevo teléfono' ? nickDe(inv['Usuario']) : '' };
}

function accionAceptar(req) {
  const t = tablaSimple('Invitaciones'), k = filaInvitacion(t, req.codigo);
  if (k < 0) throw new Error('La invitación no existe. Revisa el enlace.');
  const est = estadoInvitacion(t, k);
  if (est !== 'Pendiente') throw new Error(mensajeInvitacion(est));
  const inv = t.filas[k];
  const us = tablaSimple('Usuarios');
  const token = nuevoToken();
  let j;

  if (inv['Tipo'] === 'Nuevo teléfono') {
    j = filaUsuario(us, inv['Usuario']);
    if (j < 0 || us.filas[j]['Estado'] === 'Revocada') throw new Error('La cuenta asociada ya no está disponible.');
    escribirFila(us, j, { 'Token': hash(token) });
    registrarHistorial(us.filas[j]['Nick'], 'Nuevo teléfono vinculado', '', 'Cuenta ' + inv['Usuario']);
  } else {
    const nick = validarNick(req.nick, us);
    const creador = filaUsuario(us, inv['Creada por']);
    const rolCreador = creador >= 0 ? us.filas[creador]['Rol'] : 'Administrador';
    let estado = 'Habilitada';
    if (inv['Rol'] === 'Vecino' && APROBACION_MODERADOR_VECINOS && rango(rolCreador) < rango('Moderador')) estado = 'Aceptada';
    if (inv['Rol'] === 'Enlace' && rango(rolCreador) < rango('Moderador')) estado = 'Aceptada';
    const id = siguienteId(us);
    j = us.filas.length;
    escribirFila(us, j, { 'ID': id, 'Nick': nick, 'Rol': inv['Rol'], 'Estado': estado,
      'Invitado por': texto(inv['Creada por']), 'Fecha alta': new Date(), 'Token': hash(token) });
    escribirFila(t, k, { 'Usuario': id });
    registrarHistorial(nick, 'Invitación aceptada', '', id + ' · ' + inv['Rol'] + ' · ' + estado + ' · invitado por ' + nickDe(inv['Creada por']));
  }
  escribirFila(t, k, { 'Estado': 'Aceptada' });
  const u = usuarioDeFila(tablaSimple('Usuarios'), j);
  return { ok: true, token: token, perfil: perfilPublico(u) };
}

function accionRechazar(req) {
  const t = tablaSimple('Invitaciones'), k = filaInvitacion(t, req.codigo);
  if (k < 0 || estadoInvitacion(t, k) !== 'Pendiente') return { ok: true };
  escribirFila(t, k, { 'Estado': 'Rechazada' });
  registrarHistorial('(invitado)', 'Invitación rechazada', '', texto(t.filas[k]['Referencia']));
  return { ok: true };
}

function accionInvitar(req, u) {
  const rol = texto(req.rol) || 'Vecino';
  if (rango(rol) < 0 || rol === 'Administrador') throw new Error('Rol no válido');
  if (rol === 'Moderador') exigirRol(u, 'Administrador');
  const inv = crearInvitacion('Nueva cuenta', rol, '', limpiarTexto(req.referencia, 60), u.id);
  registrarHistorial(u.nick, 'Invitación creada', '', rol + (inv.referencia ? ' · ' + inv.referencia : ''));
  return { ok: true, codigo: inv.codigo, vence: iso(inv.vence), rol: rol };
}

function accionNuevoTelefono(req, u) {
  const us = tablaSimple('Usuarios'), j = filaUsuario(us, req.usuario);
  if (j < 0) throw new Error('Cuenta no encontrada');
  const obj = us.filas[j];
  if (obj['Estado'] === 'Revocada') throw new Error('La cuenta está revocada.');
  if (obj['ID'] !== u.id && rango(obj['Rol']) >= rango(u.rol)) throw new Error('No puedes gestionar una cuenta de tu mismo rango o superior.');
  // Anula enlaces de teléfono anteriores aún pendientes para esa cuenta
  const t = tablaSimple('Invitaciones');
  t.filas.forEach(function (f, k) {
    if (f['Tipo'] === 'Nuevo teléfono' && f['Usuario'] === obj['ID'] && estadoInvitacion(t, k) === 'Pendiente') escribirFila(t, k, { 'Estado': 'Anulada' });
  });
  const inv = crearInvitacion('Nuevo teléfono', obj['Rol'], obj['ID'], 'Nuevo teléfono de ' + obj['Nick'], u.id);
  registrarHistorial(u.nick, 'Enlace de nuevo teléfono', '', obj['Nick'] + ' (' + obj['ID'] + ')');
  return { ok: true, codigo: inv.codigo, vence: iso(inv.vence), nick: obj['Nick'] };
}

function accionUsuarios(u) {
  const us = tablaSimple('Usuarios'), t = tablaSimple('Invitaciones');
  const nicks = {};
  us.filas.forEach(function (f) { nicks[f['ID']] = f['Nick']; });
  const usuarios = us.filas.filter(function (f) { return texto(f['ID']); }).map(function (f) {
    return { id: f['ID'], nick: f['Nick'], rol: f['Rol'], estado: f['Estado'], alta: fecha(f['Fecha alta']),
      invitadoPor: nicks[f['Invitado por']] || texto(f['Invitado por']),
      gestionable: f['ID'] !== u.id && rango(f['Rol']) < rango(u.rol) };
  });
  const invitaciones = [];
  for (let k = t.filas.length - 1; k >= 0 && invitaciones.length < 100; k--) {
    const f = t.filas[k];
    if (!texto(f['Código'])) continue;
    const est = estadoInvitacion(t, k);
    invitaciones.push({ codigo: est === 'Pendiente' ? f['Código'] : '', tipo: f['Tipo'], rol: f['Rol'], estado: est,
      referencia: texto(f['Referencia']), creada: fecha(f['Creada']), vence: iso(f['Vence']),
      creadaPor: nicks[f['Creada por']] || texto(f['Creada por']), usuario: nicks[f['Usuario']] || '' });
  }
  return { ok: true, usuarios: usuarios, invitaciones: invitaciones };
}

function accionEstadoUsuario(req, u) {
  const nuevo = texto(req.estado);
  if (['Habilitada', 'En análisis', 'Revocada'].indexOf(nuevo) < 0) throw new Error('Estado no válido');
  const us = tablaSimple('Usuarios'), j = filaUsuario(us, req.usuario);
  if (j < 0) throw new Error('Cuenta no encontrada');
  const obj = us.filas[j];
  if (obj['ID'] === u.id) throw new Error('No puedes cambiar el estado de tu propia cuenta.');
  if (rango(obj['Rol']) >= rango(u.rol)) throw new Error('No puedes gestionar una cuenta de tu mismo rango o superior.');
  const anterior = texto(obj['Estado']);
  const cambios = { 'Estado': nuevo };
  if (texto(req.nota)) cambios['Notas'] = agregarNota(obj['Notas'], u.nick, req.nota);
  escribirFila(us, j, cambios);
  registrarHistorial(u.nick, 'Cuenta: ' + anterior + ' → ' + nuevo, '', obj['Nick'] + ' (' + obj['ID'] + ')' + (texto(req.nota) ? ' · ' + texto(req.nota) : ''));
  return { ok: true, mensaje: obj['Nick'] + ': ' + nuevo + '.' };
}

function accionAnularInvitacion(req, u) {
  const t = tablaSimple('Invitaciones'), k = filaInvitacion(t, req.codigo);
  if (k < 0 || estadoInvitacion(t, k) !== 'Pendiente') throw new Error('La invitación ya no está pendiente.');
  escribirFila(t, k, { 'Estado': 'Anulada' });
  registrarHistorial(u.nick, 'Invitación anulada', '', texto(t.filas[k]['Referencia']));
  return { ok: true, mensaje: 'Invitación anulada.' };
}

// ---- utilidades de cuentas ----
function crearInvitacion(tipo, rol, usuario, referencia, creadaPor) {
  const t = tablaSimple('Invitaciones');
  const codigo = nuevoCodigo(), creada = new Date(), vence = new Date(creada.getTime() + HORAS_INVITACION * 3600000);
  escribirFila(t, t.filas.length, { 'Código': codigo, 'Tipo': tipo, 'Rol': rol, 'Usuario': usuario, 'Referencia': referencia,
    'Creada': creada, 'Vence': vence, 'Creada por': creadaPor, 'Estado': 'Pendiente' });
  return { codigo: codigo, vence: vence, referencia: referencia };
}

/** Estado real de una invitación (marca como Vencida las pendientes con plazo cumplido). */
function estadoInvitacion(t, k) {
  const f = t.filas[k], est = texto(f['Estado']);
  if (est === 'Pendiente' && f['Vence'] instanceof Date && new Date() > f['Vence']) {
    escribirFila(t, k, { 'Estado': 'Vencida' });
    return 'Vencida';
  }
  return est;
}

function mensajeInvitacion(est) {
  return { 'Aceptada': 'Esta invitación ya fue usada.', 'Vencida': 'Esta invitación venció. Pide una nueva a quien te invitó.',
    'Rechazada': 'Esta invitación fue rechazada.', 'Anulada': 'Esta invitación fue anulada.' }[est] || 'Invitación no válida.';
}

function usuarioDeToken(token) {
  token = texto(token);
  if (token.length < 32) return null;
  const h = hash(token), us = tablaSimple('Usuarios');
  for (let j = 0; j < us.filas.length; j++) if (us.filas[j]['Token'] === h) return usuarioDeFila(us, j);
  return null;
}

function usuarioDeFila(us, j) {
  const f = us.filas[j];
  return { j: j, id: texto(f['ID']), nick: texto(f['Nick']), rol: texto(f['Rol']), estado: texto(f['Estado']) };
}

function perfilPublico(u) { return { id: u.id, nick: u.nick, rol: u.rol, estado: u.estado }; }

function filaUsuario(us, id) {
  id = texto(id);
  for (let j = 0; j < us.filas.length; j++) if (texto(us.filas[j]['ID']) === id && id) return j;
  return -1;
}

function filaInvitacion(t, codigo) {
  const c = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 8) return -1;
  for (let k = 0; k < t.filas.length; k++) if (texto(t.filas[k]['Código']).replace(/-/g, '') === c) return k;
  return -1;
}

function nickDe(id) {
  const us = tablaSimple('Usuarios'), j = filaUsuario(us, id);
  return j >= 0 ? us.filas[j]['Nick'] : texto(id);
}

function validarNick(v, us) {
  const n = texto(v);
  if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ0-9._\- ]{3,20}$/.test(n)) throw new Error('El nick debe tener entre 3 y 20 caracteres (letras, números, punto, guion).');
  const b = n.toLowerCase();
  if (us.filas.some(function (f) { return texto(f['Nick']).toLowerCase() === b; })) throw new Error('Ese nick ya está en uso. Elige otro.');
  return n;
}

function siguienteId(us) {
  let max = 0;
  us.filas.forEach(function (f) { const m = /^U(\d+)$/.exec(texto(f['ID'])); if (m) max = Math.max(max, +m[1]); });
  return 'U' + ('000' + (max + 1)).slice(-4);
}

/** Código legible, sin caracteres que se confunden (sin 0/O, 1/I/L). */
function nuevoCodigo() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let c = '';
  for (let i = 0; i < 12; i++) c += abc[parseInt(hex.substr(i * 2, 2), 16) % abc.length];
  return c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8, 12);
}

function nuevoToken() {
  return (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function hash(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function iso(v) { return v instanceof Date ? v.toISOString() : texto(v); }
function limpiarTexto(v, max) { return texto(v).replace(/[\r\n\t]+/g, ' ').slice(0, max); }

/** Tabla genérica: {sh, enc, col, filas:[{Encabezado: valor}]} — filas[k] corresponde a la fila k+2 de la hoja. */
function tablaSimple(nombre) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la hoja ' + nombre + '. ¿Ejecutaste prepararCuentas?');
  const v = sh.getDataRange().getValues(), enc = v[0].map(function (h) { return String(h).trim(); });
  const col = {}; enc.forEach(function (h, i) { if (h) col[h] = i; });
  let ultima = v.length - 1;
  while (ultima >= 1 && v[ultima].every(function (x) { return x === '' || x === null; })) ultima--;
  const filas = v.slice(1, ultima + 1).map(function (f) { const o = {}; enc.forEach(function (h, i) { if (h) o[h] = f[i]; }); return o; });
  return { sh: sh, enc: enc, col: col, filas: filas };
}

function escribirFila(t, k, cambios) {
  if (!t.filas[k]) t.filas[k] = {};
  Object.keys(cambios).forEach(function (h) {
    const c = t.col[h];
    if (c === undefined) throw new Error('Falta la columna "' + h + '" en ' + t.sh.getName());
    const v = cambios[h];
    t.sh.getRange(k + 2, c + 1).setValue(v instanceof Date ? v : seguro(v));
    t.filas[k][h] = v;
  });
}

function hojaCon(nombre, columnas) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------------------------------------------------------------------------
// Utilidades de escritura
// ---------------------------------------------------------------------------

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
    h.getRange(1, 1, 1, 5).setValues([['Fecha y hora', 'Quién', 'Acción', 'Patente', 'Detalle']]);
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
