/* Lector de patentes — módulo de moderación
 * Visible solo para cuentas con rol Moderador o Administrador.
 * Todas las escrituras pasan por el script, que valida la cuenta y registra cada cambio en "Historial".
 */
'use strict';

const esModerador = () => { const p = perfil(); return !!p && p.estado === 'Habilitada' && (p.rol === 'Moderador' || p.rol === 'Administrador'); };
const esAdmin = () => perfil()?.rol === 'Administrador';

function pintarModerador() {
  $('#btnMod').hidden = !esModerador();
  $('#modNombre').textContent = esModerador() ? '· ' + perfil().nick : '';
  const opMod = $('#uRol option[value=Moderador]'); if (opMod) { opMod.hidden = !esAdmin(); opMod.disabled = !esAdmin(); }
}

/** Botón que se agrega a la tarjeta de resultado. */
function botonModeracion(p) {
  return esModerador() ? `<button type="button" class="btn-mod" data-verif="${esc(p)}">🛡 Registrar verificación</button>` : '';
}

// ---------- Registrar verificación ----------
const dlgV = $('#dlgVerif');
let ctxV = null; // {p, aviso}

function abrirVerificacion(p, datos = {}) {
  const e = idxExacto.get(p) || {};
  ctxV = { p, aviso: datos.aviso || '', r: null, placas: '', estado: 'Recuperado' };
  $('#vPat').textContent = p;
  $('#vAbrir').dataset.copiar = p;
  $('#vEun').value = ''; $('#vNota').value = '';
  $('#vMa').value = datos.ma || e.ma || ''; $('#vMo').value = datos.mo || e.mo || ''; $('#vCo').value = datos.co || e.co || '';
  dlgV.querySelectorAll('.op').forEach((b) => b.classList.remove('on'));
  dlgV.querySelectorAll('[data-campo=placas] button').forEach((b) => b.classList.remove('on'));
  dlgV.querySelectorAll('[data-campo=estado] button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'Recuperado'));
  $('#vPlacas').hidden = true; $('#vEstado').hidden = true;
  $('#vInfo').textContent = ''; $('#vInfo').className = 'info';
  validarV();
  dlgV.showModal();
}

function validarV() {
  const ok = ctxV && ctxV.r && (ctxV.r !== 'placas' || ctxV.placas);
  $('#vGuardar').disabled = !ok;
}

dlgV.querySelectorAll('.op').forEach((b) => b.addEventListener('click', () => {
  ctxV.r = b.dataset.r;
  dlgV.querySelectorAll('.op').forEach((x) => x.classList.toggle('on', x === b));
  $('#vPlacas').hidden = ctxV.r !== 'placas';
  $('#vEstado').hidden = ctxV.r !== 'sin';
  validarV();
}));
dlgV.querySelectorAll('.seg').forEach((g) => g.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-v]'); if (!b) return;
  g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  ctxV[g.dataset.campo] = b.dataset.v; validarV();
}));
$('#vCancelar').addEventListener('click', () => dlgV.close());

$('#frmVerif').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if ($('#vGuardar').disabled) return;
  $('#vGuardar').disabled = true; $('#vInfo').className = 'info'; $('#vInfo').textContent = 'Guardando…';
  try {
    const j = await api('verificar', {
      patente: ctxV.p, resultado: ctxV.r, placas: ctxV.placas, estado: ctxV.estado,
      eun: $('#vEun').value.trim(), ma: $('#vMa').value.trim(), mo: $('#vMo').value.trim(), co: $('#vCo').value.trim(),
      nota: $('#vNota').value.trim(), aviso: ctxV.aviso,
    });
    dlgV.close(); toast(j.mensaje, 4000);
    await actualizarBase(true);
    if (dlgM.open) cargarListas();
  } catch (e) {
    $('#vInfo').className = 'info err'; $('#vInfo').textContent = e.message; validarV();
  }
});

// ---------- Panel de moderación ----------
const dlgM = $('#dlgMod');
let avisosCache = [];

function abrirPanel() { dlgM.showModal(); cargarListas(); }
$('#btnMod').addEventListener('click', abrirPanel);
$('#modCerrar').addEventListener('click', () => dlgM.close());
dlgM.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => mostrarTab(b.dataset.tab)));
function mostrarTab(t) {
  dlgM.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
  ['Pend', 'Avisos', 'Nuevo', 'Usuarios'].forEach((n) => { $('#tab' + n).hidden = n !== t; });
  if (t === 'Usuarios') cargarUsuarios();
}

async function cargarListas() {
  $('#lstPend').innerHTML = '<li class="m">Cargando…</li>'; $('#lstAv').innerHTML = '<li class="m">Cargando…</li>';
  const [pend, av] = await Promise.allSettled([api('pendientes'), api('avisos')]);

  if (pend.status === 'fulfilled') {
    const l = pend.value.pendientes;
    $('#nPend').textContent = pend.value.total ? `(${pend.value.total})` : '';
    $('#lstPend').innerHTML = l.length ? l.map((x) => `<li>
        <div class="cab"><span class="p">${esc(x.p)}</span>
          <span class="m">${esc([x.ma, x.mo, x.co].filter(Boolean).join(' · ') || 'sin datos del vehículo')}</span></div>
        <div class="m">${esc(x.motivo)}${x.f ? ' · reportado ' + esc(x.f) : ' · sin fecha'}${x.fv ? ' · verificado ' + esc(x.fv) : ''}</div>
        <div class="acc"><button type="button" class="primary" data-verif="${esc(x.p)}" data-ma="${esc(x.ma)}" data-mo="${esc(x.mo)}" data-co="${esc(x.co)}">Verificar</button></div>
      </li>`).join('') : '<li class="m">No hay pendientes. ¡Base al día!</li>';
  } else $('#lstPend').innerHTML = `<li class="m">Error: ${esc(pend.reason.message)}</li>`;

  if (av.status === 'fulfilled') {
    avisosCache = av.value.avisos;
    $('#nAv').textContent = avisosCache.length ? `(${avisosCache.length})` : '';
    $('#lstAv').innerHTML = avisosCache.length ? avisosCache.map((a, i) => `<li>
        <div class="cab"><span class="p">${esc(a.p || '—')}</span><span class="m">${esc(a.fecha)}</span></div>
        <div class="d"><b>${esc(a.tipo)}</b>${a.detalle ? '\n' + esc(a.detalle) : ''}</div>
        ${a.enlace ? `<div class="m"><a href="${esc(a.enlace)}" target="_blank" rel="noopener">Ver publicación / evidencia</a></div>` : ''}
        ${a.contacto ? `<div class="m">Contacto: ${esc(a.contacto)}</div>` : ''}
        <div class="acc">
          ${a.p ? `<button type="button" class="primary" data-verif="${esc(a.p)}" data-aviso="${a.fila}">Verificar</button>` : ''}
          ${a.p ? `<button type="button" data-crear="${i}">Crear reporte</button>` : ''}
          <button type="button" data-atender="${a.fila}">✓ Atendido</button>
        </div>
      </li>`).join('') : '<li class="m">No hay avisos pendientes.</li>';
  } else $('#lstAv').innerHTML = `<li class="m">Error: ${esc(av.reason.message)}</li>`;
}

$('#lstAv').addEventListener('click', async (ev) => {
  const c = ev.target.closest('[data-crear]');
  if (c) {
    const a = avisosCache[+c.dataset.crear];
    $('#frmNuevo').reset(); $('#frmNuevo').dataset.aviso = a.fila;
    $('#nPat').value = a.p; $('#nEnlace').value = /^https?:\/\//.test(a.enlace) ? a.enlace : '';
    $('#nNota').value = a.detalle; $('#nInfo').textContent = '';
    mostrarTab('Nuevo'); return;
  }
  const t = ev.target.closest('[data-atender]');
  if (t) {
    t.disabled = true;
    try { const j = await api('atender', { fila: +t.dataset.atender }); toast(j.mensaje); cargarListas(); }
    catch (e) { toast(e.message, 4000); t.disabled = false; }
  }
});

$('#frmNuevo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target, btn = f.querySelector('button[type=submit]');
  btn.disabled = true; $('#nInfo').className = 'info'; $('#nInfo').textContent = 'Guardando…';
  try {
    const j = await api('nuevo', {
      patente: $('#nPat').value, ma: $('#nMa').value.trim(), mo: $('#nMo').value.trim(), co: $('#nCo').value.trim(),
      fechaRobo: $('#nFecha').value, sector: $('#nSector').value.trim(), enlace: $('#nEnlace').value.trim(),
      nota: $('#nNota').value.trim(), aviso: f.dataset.aviso || '',
    });
    toast(j.mensaje, 4000); f.reset(); delete f.dataset.aviso; $('#nInfo').textContent = '';
    await actualizarBase(true); cargarListas(); mostrarTab('Pend');
  } catch (e) { $('#nInfo').className = 'info err'; $('#nInfo').textContent = e.message; }
  finally { btn.disabled = false; }
});
$('#frmNuevo').addEventListener('reset', (ev) => { delete ev.target.dataset.aviso; });

// Botones "Registrar verificación" / "Verificar" en cualquier parte de la app
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-verif]'); if (!b) return;
  abrirVerificacion(b.dataset.verif, { ma: b.dataset.ma, mo: b.dataset.mo, co: b.dataset.co, aviso: b.dataset.aviso });
});

// ---------- Usuarios e invitaciones ----------
const COLOR_ESTADO = { 'Pendiente': 'amarillo', 'Aceptada': 'azul', 'Habilitada': 'verde', 'En análisis': 'naranjo',
  'Rechazada': 'gris', 'Vencida': 'gris', 'Revocada': 'gris', 'Anulada': 'gris' };
const fechaCorta = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }); };

function enlaceInvitacion(codigo) {
  let u = location.origin + location.pathname + '#i=' + codigo.replace(/-/g, '');
  if (!SERVIDOR) { const m = /\/macros\/s\/([\w-]+)\/exec/.exec(servidor()); if (m) u += '&s=' + m[1]; }
  return u;
}
function textoInvitacion(codigo, nuevoTel) {
  return (nuevoTel
    ? 'Este es tu enlace para vincular tu nuevo teléfono a tu cuenta del Lector de patentes vecinal:'
    : 'Hola, te invito al Lector de patentes vecinal de Brisa del Sol. Abre este enlace desde tu celular para activar tu cuenta:')
    + '\n' + enlaceInvitacion(codigo) + '\n\nSirve una sola vez y vence en 48 horas. Código: ' + codigo;
}

function mostrarInvitacionCreada(codigo, vence, titulo, nuevoTel = false) {
  const txt = textoInvitacion(codigo, nuevoTel);
  $('#uResultado').hidden = false;
  $('#uResultado').innerHTML = `<b>${esc(titulo)}</b>
    <div class="codigo">${esc(codigo)}</div>
    <div class="m">Vence: ${esc(fechaCorta(vence))} · sirve una sola vez</div>
    <div class="acc">
      <a class="btn primary" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">WhatsApp</a>
      <button type="button" data-compartir="${esc(codigo)}" data-tel="${nuevoTel ? 1 : ''}">Compartir…</button>
      <button type="button" data-copiar-txt="${esc(codigo)}" data-tel="${nuevoTel ? 1 : ''}">Copiar</button>
    </div>`;
  $('#uResultado').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('#frmInvitar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.target.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const rol = $('#uRol').value;
    const j = await api('invitar', { rol, referencia: $('#uRef').value.trim() });
    mostrarInvitacionCreada(j.codigo, j.vence, `Invitación de ${rol} creada`);
    $('#uRef').value = ''; cargarUsuarios(false);
  } catch (e) { toast(e.message, 4000); }
  finally { btn.disabled = false; }
});

let usuariosCache = { usuarios: [], invitaciones: [] };
async function cargarUsuarios(limpiar = true) {
  if (limpiar) $('#uResultado').hidden = true;
  $('#lstInv').innerHTML = '<li class="m">Cargando…</li>'; $('#lstUsu').innerHTML = '';
  try { usuariosCache = await api('usuarios'); }
  catch (e) { $('#lstInv').innerHTML = `<li class="m">Error: ${esc(e.message)}</li>`; return; }
  const { usuarios, invitaciones } = usuariosCache;
  const pend = invitaciones.filter((i) => i.estado === 'Pendiente');
  const otras = invitaciones.filter((i) => i.estado !== 'Pendiente').slice(0, 30);
  $('#lstInv').innerHTML = (pend.concat(otras).map((i) => `<li class="est-${COLOR_ESTADO[i.estado] || 'gris'}">
      <div class="cab"><span class="estado">${esc(i.estado)}</span><b>${esc(i.tipo === 'Nuevo teléfono' ? 'Nuevo teléfono' : i.rol)}</b>
        <span class="m">${esc(i.referencia || '')}</span></div>
      <div class="m">Creada ${esc(i.creada)} por ${esc(i.creadaPor)}${i.usuario ? ' · usada por <b>' + esc(i.usuario) + '</b>' : ''}${i.estado === 'Pendiente' ? ' · vence ' + esc(fechaCorta(i.vence)) : ''}</div>
      ${i.estado === 'Pendiente' ? `<div class="acc">
        <button type="button" data-reenviar="${esc(i.codigo)}" data-tel="${i.tipo === 'Nuevo teléfono' ? 1 : ''}" data-vence="${esc(i.vence)}">Enviar de nuevo</button>
        <button type="button" data-anular="${esc(i.codigo)}">Anular</button></div>` : ''}
    </li>`).join('')) || '<li class="m">Aún no hay invitaciones.</li>';
  $('#nUsu').textContent = usuarios.length ? `(${usuarios.length})` : '';
  $('#lstUsu').innerHTML = usuarios.slice().reverse().map((u) => `<li class="est-${COLOR_ESTADO[u.estado] || 'gris'}">
      <div class="cab"><span class="estado">${esc(u.estado)}</span><span class="p">${esc(u.nick)}</span><span class="m">${esc(u.rol)} · ${esc(u.id)}</span></div>
      <div class="m">Desde ${esc(u.alta)}${u.invitadoPor ? ' · invitado por ' + esc(u.invitadoPor) : ''}</div>
      ${u.gestionable ? `<div class="acc">
        <button type="button" data-tel-nuevo="${esc(u.id)}">Nuevo teléfono</button>
        ${u.estado !== 'En análisis' ? `<button type="button" data-estado="En análisis" data-u="${esc(u.id)}">En análisis</button>` : ''}
        ${u.estado !== 'Habilitada' ? `<button type="button" data-estado="Habilitada" data-u="${esc(u.id)}">Habilitar</button>` : ''}
        ${u.estado !== 'Revocada' ? `<button type="button" class="peligro" data-estado="Revocada" data-u="${esc(u.id)}">Revocar</button>` : ''}
      </div>` : ''}
    </li>`).join('') || '<li class="m">Aún no hay usuarios.</li>';
}

async function compartir(codigo, nuevoTel) {
  const txt = textoInvitacion(codigo, nuevoTel);
  if (navigator.share) { try { await navigator.share({ text: txt }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(txt); toast('Invitación copiada: pégala en WhatsApp'); } catch { toast('No se pudo copiar'); }
}

$('#tabUsuarios').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.compartir) return compartir(b.dataset.compartir, !!b.dataset.tel);
  if (b.dataset.copiarTxt) {
    try { await navigator.clipboard.writeText(textoInvitacion(b.dataset.copiarTxt, !!b.dataset.tel)); toast('Invitación copiada'); } catch { toast('No se pudo copiar'); }
    return;
  }
  if (b.dataset.reenviar) return mostrarInvitacionCreada(b.dataset.reenviar, b.dataset.vence, 'Invitación pendiente', !!b.dataset.tel);
  try {
    if (b.dataset.anular) {
      if (!confirm('¿Anular esta invitación? El enlace dejará de funcionar.')) return;
      b.disabled = true; toast((await api('anularInvitacion', { codigo: b.dataset.anular })).mensaje);
    } else if (b.dataset.telNuevo) {
      b.disabled = true;
      const j = await api('nuevoTelefono', { usuario: b.dataset.telNuevo });
      mostrarInvitacionCreada(j.codigo, j.vence, `Enlace de nuevo teléfono para ${j.nick}`, true);
      return cargarUsuarios(false);
    } else if (b.dataset.estado) {
      const nota = b.dataset.estado === 'Habilitada' ? '' : prompt(`Motivo (${b.dataset.estado}), queda en el historial:`, '');
      if (nota === null) return;
      b.disabled = true; toast((await api('estadoUsuario', { usuario: b.dataset.u, estado: b.dataset.estado, nota })).mensaje);
    } else return;
    cargarUsuarios(false);
  } catch (e) { toast(e.message, 4000); b.disabled = false; }
});

pintarModerador();
