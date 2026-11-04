/* Lector de patentes — cuentas por invitación
 * Sin contraseñas: al aceptar una invitación, el teléfono recibe un token que lo vincula a la cuenta.
 * El servidor guarda solo una huella (hash) del token. No se registra qué patentes consulta cada persona.
 */
'use strict';

const sesion = () => leerLS(LS.sesion, null);
const perfil = () => sesion()?.perfil || null;

/** URL del servidor: la incorporada en la app manda; si no hay, la recibida en la invitación. */
function servidor() {
  const cfg = leerLS(LS.config, {});
  if (cfg.manual && cfg.url) return cfg.url;
  return SERVIDOR || cfg.url || '';
}

/** Llamada al script. Lanza Error con .sesion si la cuenta no está habilitada. */
async function api(accion, datos = {}, conToken = true) {
  const url = servidor();
  if (!url) throw new Error('La app no sabe a qué servidor conectarse. Abre tu enlace de invitación.');
  let r;
  try {
    // text/plain evita la consulta previa (CORS) que Apps Script no responde
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...datos, accion, ...(conToken ? { token: sesion()?.token || '' } : {}) }) });
  } catch { throw new Error('Sin conexión con el servidor'); }
  let j; try { j = await r.json(); } catch { throw new Error('Respuesta inesperada del servidor. ¿Está publicada la última versión del script?'); }
  if (j.error) {
    const e = new Error(j.error); e.sesion = j.sesion;
    if (j.perfil) actualizarPerfil(j.perfil);
    if (j.sesion === 'invalida') { guardarLS(LS.sesion, null); pintarCuenta(); }
    throw e;
  }
  return j;
}

function actualizarPerfil(p) {
  const s = sesion(); if (!s) return;
  s.perfil = p; guardarLS(LS.sesion, s); pintarCuenta();
}

function pintarCuenta() {
  const p = perfil();
  if (typeof pintarModerador === 'function') pintarModerador();
  if (!sesion()) { $('#estadoBase').textContent = 'Sin cuenta'; $('#estadoBase').className = 'pill warn'; }
  else if (p && p.estado !== 'Habilitada') { $('#estadoBase').textContent = p.estado; $('#estadoBase').className = 'pill warn'; }
  else pintarEstadoBase();
}

// ---------- Invitaciones ----------
const dlgI = $('#dlgInvitacion');
let invActual = null;

/** Extrae código (y servidor, si viene) desde un enlace completo o un código suelto. */
function leerInvitacion(texto) {
  const t = String(texto || '').trim();
  let codigo = '', s = '';
  const h = t.includes('#') ? t.slice(t.indexOf('#') + 1) : '';
  if (h) { const q = new URLSearchParams(h); codigo = q.get('i') || ''; s = q.get('s') || ''; }
  else codigo = t;
  codigo = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return codigo.length >= 8 ? { codigo, s } : null;
}

async function abrirInvitacion(inv) {
  // Solo se acepta un servidor desde el enlace si la app no trae uno incorporado
  if (inv.s && !SERVIDOR && /^[\w-]{20,}$/.test(inv.s)) {
    const cfg = leerLS(LS.config, {});
    if (!cfg.manual) guardarLS(LS.config, { ...cfg, url: `https://script.google.com/macros/s/${inv.s}/exec` });
  }
  invActual = inv;
  $('#iCuerpo').hidden = true; $('#iInfo').className = 'info'; $('#iInfo').textContent = 'Revisando la invitación…';
  $('#iAceptar').hidden = true; $('#iRechazar').hidden = true;
  if (!dlgI.open) dlgI.showModal();
  try {
    const j = await api('invitacion', { codigo: inv.codigo }, false);
    invActual.tipo = j.tipo;
    const nuevoTel = j.tipo === 'Nuevo teléfono';
    $('#iTitulo').textContent = nuevoTel ? 'Vincular este teléfono a tu cuenta' : 'Te invitaron a Lector de patentes';
    $('#iRol').textContent = nuevoTel ? `Cuenta: ${j.nick}` : `Rol: ${j.rol}`;
    $('#iNickBloque').hidden = nuevoTel;
    $('#iNick').value = '';
    const s = sesion();
    $('#iAviso').hidden = !s;
    if (s) $('#iAviso').textContent = `Este teléfono ya tiene la cuenta «${s.perfil?.nick}». Si aceptas, será reemplazada.`;
    $('#iVence').textContent = 'Vence: ' + new Date(j.vence).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
    $('#iAcepto').checked = false;
    $('#iCuerpo').hidden = false; $('#iAceptar').hidden = false; $('#iRechazar').hidden = nuevoTel;
    $('#iInfo').textContent = '';
  } catch (e) {
    $('#iTitulo').textContent = 'Invitación no disponible';
    $('#iInfo').className = 'info err'; $('#iInfo').textContent = e.message;
  }
}

$('#frmInvitacion').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!$('#iAcepto').checked) { $('#iInfo').className = 'info err'; $('#iInfo').textContent = 'Debes aceptar las condiciones de uso.'; return; }
  $('#iAceptar').disabled = true; $('#iInfo').className = 'info'; $('#iInfo').textContent = 'Activando…';
  try {
    const j = await api('aceptar', { codigo: invActual.codigo, nick: $('#iNick').value.trim() }, false);
    guardarLS(LS.sesion, { token: j.token, perfil: j.perfil });
    dlgI.close(); pintarCuenta();
    toast(`¡Listo, ${j.perfil.nick}! Tu cuenta está ${j.perfil.estado === 'Habilitada' ? 'activa' : 'esperando aprobación'}.`, 4500);
    $('#dlgBienvenida').open && $('#dlgBienvenida').close();
    await actualizarBase(true);
  } catch (e) { $('#iInfo').className = 'info err'; $('#iInfo').textContent = e.message; }
  finally { $('#iAceptar').disabled = false; }
});
$('#iRechazar').addEventListener('click', async () => {
  if (!confirm('¿Rechazar la invitación? El enlace dejará de funcionar.')) return;
  try { await api('rechazar', { codigo: invActual.codigo }, false); } catch {}
  dlgI.close(); toast('Invitación rechazada.');
  if (!sesion()) mostrarBienvenida();
});
$('#iCerrar').addEventListener('click', () => { dlgI.close(); if (!sesion()) mostrarBienvenida(); });

// ---------- Bienvenida (teléfono sin cuenta) ----------
function mostrarBienvenida() { if (!$('#dlgBienvenida').open) $('#dlgBienvenida').showModal(); }
$('#frmCodigoB').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const inv = leerInvitacion($('#bCodigo').value);
  if (!inv) { toast('Ese enlace o código no es válido.'); return; }
  $('#dlgBienvenida').close(); abrirInvitacion(inv);
});

// ---------- Mi cuenta (⚙) ----------
const dlgC = $('#dlgCuenta');
function abrirCuenta() {
  const p = perfil();
  $('#cNick').textContent = p ? p.nick : 'Sin cuenta';
  $('#cDetalle').textContent = p ? `${p.rol} · ${p.estado} · ID ${p.id}` : 'Este teléfono no está vinculado a ninguna cuenta.';
  $('#cBase').textContent = base ? `Base: ${base.patentes.length} registros, descargada ${hace(base.ts)}.` : 'Aún no hay base descargada.';
  $('#cDesvincular').hidden = !p;
  $('#cActualizar').hidden = !p;
  const cfg = leerLS(LS.config, {});
  $('#cServidor').value = cfg.manual ? cfg.url : servidor();
  $('#cCodigo').value = '';
  dlgC.showModal();
}
$('#btnConfig').addEventListener('click', abrirCuenta);
$('#estadoBase').addEventListener('click', abrirCuenta);
$('#cCerrar').addEventListener('click', () => dlgC.close());
$('#cActualizar').addEventListener('click', async () => { $('#cBase').textContent = 'Descargando…'; await actualizarBase(); abrirCuenta(); });
$('#frmCodigoC').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const inv = leerInvitacion($('#cCodigo').value);
  if (!inv) { toast('Ese enlace o código no es válido.'); return; }
  dlgC.close(); abrirInvitacion(inv);
});
$('#cGuardarServidor').addEventListener('click', () => {
  const v = $('#cServidor').value.trim(), cfg = leerLS(LS.config, {});
  if (v && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(v)) { toast('La URL debe ser https://script.google.com/macros/s/…/exec'); return; }
  guardarLS(LS.config, v ? { ...cfg, url: v, manual: true } : { ...cfg, manual: false });
  toast(v ? 'Servidor guardado' : 'Se usará el servidor incorporado');
});
$('#cDesvincular').addEventListener('click', () => {
  if (!confirm('¿Desvincular este teléfono? Para volver a entrar necesitarás un enlace nuevo de quien te invitó.')) return;
  guardarLS(LS.sesion, null); guardarLS(LS.base, null); base = null; indexar(); pintarCuenta();
  dlgC.close(); mostrarBienvenida();
});

// ---------- Inicio ----------
(function iniciar() {
  const inv = location.hash.includes('i=') ? leerInvitacion(location.href) : null;
  if (inv) { history.replaceState(null, '', location.pathname + location.search); abrirInvitacion(inv); }
  else if (!sesion()) setTimeout(mostrarBienvenida, 300);
  pintarCuenta();
  if (sesion() && navigator.onLine) actualizarBase(true);
})();
