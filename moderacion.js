/* Lector de patentes — módulo de moderación
 * Visible solo en teléfonos con una clave de moderador válida (hoja "Moderadores").
 * Todas las escrituras pasan por el script, que valida la clave y registra cada cambio en "Historial".
 */
'use strict';

const esModerador = () => !!leerLS(LS.config, {}).modNombre;

async function api(accion, datos = {}) {
  const cfg = leerLS(LS.config, {});
  if (!cfg.url || !cfg.mod) throw new Error('Falta la clave de moderador');
  let r;
  try {
    // text/plain evita la consulta previa (CORS) que Apps Script no responde
    r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...datos, accion, mod: cfg.mod }) });
  } catch { throw new Error('Sin conexión con la planilla'); }
  let j; try { j = await r.json(); } catch { throw new Error('Respuesta inesperada del script. ¿Publicaste la nueva versión?'); }
  if (j.error) throw new Error(j.error);
  return j;
}

async function refrescarModerador(silencioso = false) {
  const cfg = leerLS(LS.config, {});
  if (!cfg.mod) { if (cfg.modNombre) { cfg.modNombre = ''; guardarLS(LS.config, cfg); } pintarModerador(); return; }
  try {
    const j = await api('login');
    cfg.modNombre = j.nombre; if (!silencioso) toast(`Modo moderador activo: ${j.nombre}`);
  } catch (e) {
    if (silencioso && /conexión/.test(e.message)) return; // sin señal: se mantiene el estado anterior
    cfg.modNombre = ''; toast('Clave de moderador: ' + e.message, 4500);
  }
  guardarLS(LS.config, cfg); pintarModerador();
}

function pintarModerador() {
  $('#btnMod').hidden = !esModerador();
  $('#modNombre').textContent = esModerador() ? '· ' + leerLS(LS.config, {}).modNombre : '';
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
  ['Pend', 'Avisos', 'Nuevo'].forEach((n) => { $('#tab' + n).hidden = n !== t; });
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

pintarModerador();
if (leerLS(LS.config, {}).mod && navigator.onLine) refrescarModerador(true);
