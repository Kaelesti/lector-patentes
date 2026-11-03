/* Lector de patentes — PWA vecinal
 * Lee placas con la cámara (detector YOLOv9 + OCR fast-plate-ocr, ambos en ONNX dentro del navegador)
 * y las coteja con la lista entregada por el script de Google Sheets.
 * No guarda fotos ni ubicación. Todo el reconocimiento ocurre en el teléfono.
 */
'use strict';

// ---------- Configuración general ----------
const DET_SIZE = 384;          // entrada del detector
const DET_UMBRAL = 0.45;       // confianza mínima de detección
const OCR_W = 128, OCR_H = 64; // entrada del OCR
const OCR_ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_';
const OCR_CONF_MIN = 0.60;     // confianza mínima por carácter para considerar la lectura
const INTERVALO_MS = 220;      // pausa mínima entre análisis en vivo
const CONSENSO_VECES = 2;      // lecturas iguales necesarias en vivo
const CONSENSO_VENTANA_MS = 4000;
const REPETIR_TRAS_MS = 60000; // no repetir la misma patente en el historial antes de esto

const LS = { config: 'lp_config', base: 'lp_base', hist: 'lp_historial' };

ort.env.wasm.numThreads = 1;            // GitHub Pages no permite hilos (sin aislamiento COOP/COEP)
ort.env.wasm.wasmPaths = new URL('vendor/ort/', location.href).href; // ruta absoluta (relativa se resuelve mal)

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
function leerLS(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } }
function guardarLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function hace(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
function fechaHora(ts) {
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- Formato de patentes chilenas ----------
// Nueva: 4 letras (sin vocales ni M, N, Ñ, Q) + 2 números.  Antigua: 2 letras + 4 números.
const RE_NUEVA = /^[BCDFGHJKLPRSTVWXYZ]{4}\d{2}$/;
const RE_ANTIGUA = /^[A-Z]{2}\d{4}$/;
const A_NUM = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', J: '1', Z: '2', S: '5', G: '6', T: '7', B: '8', A: '4' };
const A_LETRA_NUEVA = { '0': 'D', '8': 'B', '5': 'S', '2': 'Z', '6': 'G', '7': 'T', '1': 'L' };
const A_LETRA_ANTIGUA = { '0': 'O', '8': 'B', '5': 'S', '2': 'Z', '6': 'G', '7': 'T', '1': 'I', '4': 'A' };

const limpiar = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function ajustar(t, letras, mapaLetra) {
  let cambios = 0, out = '';
  for (let i = 0; i < 6; i++) {
    const c = t[i], quiereLetra = i < letras;
    if (quiereLetra && /\d/.test(c)) { if (!mapaLetra[c]) return null; out += mapaLetra[c]; cambios++; }
    else if (!quiereLetra && /[A-Z]/.test(c)) { if (!A_NUM[c]) return null; out += A_NUM[c]; cambios++; }
    else out += c;
  }
  return { texto: out, cambios };
}

/** Devuelve {texto, cambios} con formato chileno válido, o null. */
function normalizarChilena(bruto) {
  const t = limpiar(bruto);
  const candidatos = [];
  const probar = (s, extra = 0) => {
    if (s.length !== 6) return;
    const n = ajustar(s, 4, A_LETRA_NUEVA); if (n && RE_NUEVA.test(n.texto)) candidatos.push({ ...n, cambios: n.cambios + extra });
    const a = ajustar(s, 2, A_LETRA_ANTIGUA); if (a && RE_ANTIGUA.test(a.texto)) candidatos.push({ ...a, cambios: a.cambios + extra });
  };
  probar(t);
  // Un carácter de más (borde o separador): se prefiere quitar el primero o el último
  if (t.length === 7) for (let i = 0; i < 7; i++) probar(t.slice(0, i) + t.slice(i + 1), i === 0 || i === 6 ? 0.5 : 1);
  if (!candidatos.length) return null;
  candidatos.sort((x, y) => x.cambios - y.cambios);
  return candidatos[0].cambios <= 2 ? candidatos[0] : null;
}

// Forma "canónica" para detectar posibles confusiones del lector (0/O/D, 8/B, 5/S, ...)
const canonica = (s) => s.replace(/[OQDU]/g, '0').replace(/[ILJ]/g, '1').replace(/Z/g, '2')
  .replace(/S/g, '5').replace(/G/g, '6').replace(/B/g, '8').replace(/T/g, '7');

// ---------- Base de datos ----------
let base = leerLS(LS.base, null);    // {ts, patentes:[{p,t,e,f}]}
let idxExacto = new Map(), idxCanon = new Map();

function indexar() {
  idxExacto = new Map(); idxCanon = new Map();
  for (const r of (base?.patentes || [])) {
    const p = limpiar(r.p); if (!p) continue;
    const e = { ...r, p };
    idxExacto.set(p, e);
    const c = canonica(p);
    if (!idxCanon.has(c)) idxCanon.set(c, []);
    idxCanon.get(c).push(e);
  }
  pintarEstadoBase();
  const enl = $('#lnkNuevo');
  if (enl) { const u = urlFormulario(''); enl.hidden = !u; if (u) enl.href = u; }
}

function urlFormulario(p) {
  const f = base?.formulario; if (!f) return '';
  return f.replace('PATENTE', encodeURIComponent(p));
}
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLOR = { encargo: '#E5484D', placa: '#A869E0', vecinal: '#F5A524', posible: '#F5A524', prueba: '#3E8EDE' };
const colorLectura = (l) => COLOR[l.estado] || (l.valida ? '#30A46C' : '#F2B705');

// Nivel de alerta de un registro: encargo (oficial) · placa (placas sustraídas, oficial) · vecinal · prueba
const nivelDe = (r) => r.n || (r.t === 'prueba' ? 'prueba' : 'vecinal'); // compatible con el script v1

function buscar(p) {
  const exacta = idxExacto.get(p);
  if (exacta) return { tipo: nivelDe(exacta), entrada: exacta };
  const pos = idxCanon.get(canonica(p));
  if (pos && pos.length) return { tipo: 'posible', entrada: pos[0], otras: pos };
  return { tipo: 'sin' };
}

function pintarEstadoBase() {
  const el = $('#estadoBase');
  if (!base) { el.textContent = 'Sin base'; el.className = 'pill warn'; return; }
  const n = base.patentes.filter((r) => nivelDe(r) !== 'prueba').length;
  el.textContent = `Base: ${n} · ${hace(base.ts)}`;
  el.className = 'pill ' + (Date.now() - base.ts > 3 * 86400000 ? 'warn' : 'ok');
}

async function actualizarBase(silencioso = false) {
  const cfg = leerLS(LS.config, null);
  if (!cfg?.url || !cfg?.clave) { if (!silencioso) toast('Configura la URL y la clave en ⚙'); return false; }
  try {
    const u = cfg.url + (cfg.url.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(cfg.clave);
    const r = await fetch(u, { cache: 'no-store' });
    const j = await r.json();
    if (j.error) throw new Error(j.error === 'no autorizado' ? 'Clave incorrecta' : j.error);
    if (!Array.isArray(j.patentes)) throw new Error('Respuesta inesperada del script');
    base = { ts: Date.now(), patentes: j.patentes, formulario: j.formulario || '' };
    guardarLS(LS.base, base); indexar();
    if (!silencioso) toast(`Base actualizada: ${j.patentes.length} patentes`);
    return true;
  } catch (e) {
    if (!silencioso) toast('No se pudo actualizar la base: ' + e.message, 4000);
    return false;
  }
}

// ---------- Motor de reconocimiento ----------
let det = null, ocr = null, cargandoMotor = null;
function estadoMotor(t) { const el = $('#estadoMotor'); el.hidden = !t; el.textContent = t || ''; }

function cargarMotor() {
  if (det && ocr) return Promise.resolve();
  if (cargandoMotor) return cargandoMotor;
  estadoMotor('Cargando motor de lectura… (solo la primera vez tarda)');
  const op = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  cargandoMotor = Promise.all([
    ort.InferenceSession.create('models/detector-placas.onnx', op),
    ort.InferenceSession.create('models/ocr-placas.onnx', op),
  ]).then(([d, o]) => { det = d; ocr = o; estadoMotor(''); })
    .catch((e) => { cargandoMotor = null; estadoMotor('Error al cargar el motor: ' + e.message); throw e; });
  return cargandoMotor;
}

const cvDet = document.createElement('canvas'); cvDet.width = cvDet.height = DET_SIZE;
const ctxDet = cvDet.getContext('2d', { willReadFrequently: true });
const cvOcr = document.createElement('canvas'); cvOcr.width = OCR_W; cvOcr.height = OCR_H;
const ctxOcr = cvOcr.getContext('2d', { willReadFrequently: true });

/** Analiza la región R={x,y,w,h} de la fuente (video, imagen o canvas). Devuelve [{caja, texto, conf, puntaje}] */
async function analizar(fuente, R) {
  // 1) Detector: letterbox de la región a 384x384, relleno gris 114
  const r = Math.min(DET_SIZE / R.w, DET_SIZE / R.h);
  const nw = Math.round(R.w * r), nh = Math.round(R.h * r);
  const dw = (DET_SIZE - nw) / 2, dh = (DET_SIZE - nh) / 2;
  ctxDet.fillStyle = 'rgb(114,114,114)'; ctxDet.fillRect(0, 0, DET_SIZE, DET_SIZE);
  ctxDet.drawImage(fuente, R.x, R.y, R.w, R.h, dw, dh, nw, nh);
  const px = ctxDet.getImageData(0, 0, DET_SIZE, DET_SIZE).data;
  const N = DET_SIZE * DET_SIZE, f = new Float32Array(3 * N);
  for (let i = 0, j = 0; i < N; i++, j += 4) { f[i] = px[j] / 255; f[N + i] = px[j + 1] / 255; f[2 * N + i] = px[j + 2] / 255; }
  const salidaDet = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, DET_SIZE, DET_SIZE]) });
  const o = salidaDet[det.outputNames[0]], d = o.data, filas = o.dims[0];

  const res = [];
  for (let k = 0; k < filas; k++) {
    const b = k * 7, puntaje = d[b + 6];
    if (puntaje < DET_UMBRAL) continue;
    let x1 = (d[b + 1] - dw) / r + R.x, y1 = (d[b + 2] - dh) / r + R.y;
    let x2 = (d[b + 3] - dw) / r + R.x, y2 = (d[b + 4] - dh) / r + R.y;
    x1 = Math.max(R.x, x1); y1 = Math.max(R.y, y1); x2 = Math.min(R.x + R.w, x2); y2 = Math.min(R.y + R.h, y2);
    const w = x2 - x1, h = y2 - y1; if (w < 8 || h < 4) continue;

    // 2) OCR: recorte estirado a 128x64 RGB uint8
    ctxOcr.drawImage(fuente, x1, y1, w, h, 0, 0, OCR_W, OCR_H);
    const q = ctxOcr.getImageData(0, 0, OCR_W, OCR_H).data;
    const u = new Uint8Array(OCR_W * OCR_H * 3);
    for (let i = 0, j = 0; i < q.length; i += 4) { u[j++] = q[i]; u[j++] = q[i + 1]; u[j++] = q[i + 2]; }
    const so = await ocr.run({ [ocr.inputNames[0]]: new ort.Tensor('uint8', u, [1, OCR_H, OCR_W, 3]) });
    const pl = so.plate || so[ocr.outputNames[0]];
    const slots = pl.dims[1], C = pl.dims[2], pd = pl.data;
    let texto = '', confMin = 1;
    for (let s = 0; s < slots; s++) {
      let mi = 0, mv = -1;
      for (let c = 0; c < C; c++) { const v = pd[s * C + c]; if (v > mv) { mv = v; mi = c; } }
      const ch = OCR_ALFABETO[mi];
      if (ch !== '_') { texto += ch; confMin = Math.min(confMin, mv); }
    }
    res.push({ caja: { x1, y1, x2, y2 }, texto, conf: texto ? confMin : 0, puntaje });
  }
  return res;
}

// ---------- Cámara ----------
const video = $('#video'), overlay = $('#overlay'), octx = overlay.getContext('2d');
let stream = null, enVivo = false, zoom = 1, wakeLock = null, linterna = false;
const consenso = new Map();      // texto -> [timestamps]
const ultimaVez = new Map();     // texto -> ts agregado al historial

async function iniciarCamara() {
  if (stream) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    $('#camaraMsg').innerHTML = 'No se pudo abrir la cámara (permiso denegado o sin HTTPS).<br>Puedes usar <b>&nbsp;Foto</b>.';
    return false;
  }
  video.srcObject = stream; await video.play();
  $('#camaraMsg').hidden = true;
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  $('#btnLinterna').hidden = !caps.torch;
  return true;
}

function detenerCamara() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; video.srcObject = null; linterna = false;
}

/** Región del cuadro de video que el usuario ve (object-fit: cover + zoom). */
function regionVisible() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = overlay.clientWidth, ch = overlay.clientHeight;
  const s = Math.max(cw / vw, ch / vh);
  let w = cw / s, h = ch / s;
  w /= zoom; h /= zoom;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

function ajustarOverlay() {
  const dpr = window.devicePixelRatio || 1;
  overlay.width = overlay.clientWidth * dpr; overlay.height = overlay.clientHeight * dpr;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function dibujarCajas(R, lecturas) {
  ajustarOverlay();
  const cw = overlay.clientWidth, ch = overlay.clientHeight;
  octx.clearRect(0, 0, cw, ch);
  for (const l of lecturas) {
    const x = (l.caja.x1 - R.x) / R.w * cw, y = (l.caja.y1 - R.y) / R.h * ch;
    const w = (l.caja.x2 - l.caja.x1) / R.w * cw, h = (l.caja.y2 - l.caja.y1) / R.h * ch;
    const color = colorLectura(l);
    octx.lineWidth = 3; octx.strokeStyle = color; octx.strokeRect(x, y, w, h);
    const t = l.mostrar || '…';
    octx.font = 'bold 16px ui-monospace, monospace';
    const tw = octx.measureText(t).width + 10;
    octx.fillStyle = color; octx.fillRect(x, Math.max(0, y - 24), tw, 22);
    octx.fillStyle = '#000'; octx.fillText(t, x + 5, Math.max(16, y - 7));
  }
}

async function cicloVivo() {
  if (!enVivo) return;
  const t0 = performance.now();
  try {
    if (video.readyState >= 2 && !document.hidden) {
      const R = regionVisible();
      const lect = await analizar(video, R);
      procesarLecturas(lect, 'Tiempo real');
      dibujarCajas(R, lect);
      const ms = Math.round(performance.now() - t0);
      estadoMotor(`${ms} ms por cuadro`);
    }
  } catch (e) { console.error(e); }
  setTimeout(cicloVivo, Math.max(30, INTERVALO_MS - (performance.now() - t0)));
}

async function alternarVivo() {
  if (enVivo) {
    enVivo = false; detenerCamara(); octx.clearRect(0, 0, overlay.width, overlay.height);
    $('#btnVivo').textContent = '▶ En vivo'; $('#camaraMsg').hidden = false; estadoMotor('');
    $('#btnLinterna').hidden = true;
    try { wakeLock && (await wakeLock.release()); } catch {} wakeLock = null;
    return;
  }
  $('#btnVivo').disabled = true;
  try {
    const [ok] = await Promise.all([iniciarCamara(), cargarMotor()]);
    if (!ok) return;
    enVivo = true; $('#btnVivo').textContent = '⏸ Detener';
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    cicloVivo();
  } catch (e) { toast('No se pudo iniciar: ' + e.message, 4000); }
  finally { $('#btnVivo').disabled = false; }
}

$('#btnVivo').addEventListener('click', alternarVivo);

// ---------- Interpretación de lecturas ----------
function procesarLecturas(lecturas, modo) {
  const ahora = Date.now();
  for (const l of lecturas) {
    const n = l.conf >= OCR_CONF_MIN ? normalizarChilena(l.texto) : null;
    l.valida = !!n;
    l.mostrar = n ? n.texto : (l.texto ? l.texto + '?' : '');
    if (!n) continue;
    const p = n.texto, b = buscar(p);
    l.estado = b.tipo;

    let confirmar = false;
    if (modo === 'Tiempo real') {
      const arr = (consenso.get(p) || []).filter((ts) => ahora - ts < CONSENSO_VENTANA_MS);
      arr.push(ahora); consenso.set(p, arr);
      confirmar = arr.length >= CONSENSO_VECES;
    } else confirmar = true;

    if (confirmar && (modo !== 'Tiempo real' || !(ahora - (ultimaVez.get(p) || 0) < REPETIR_TRAS_MS))) {
      ultimaVez.set(p, ahora);
      registrar({ leida: p, conf: l.conf, modo, resultado: b.tipo, ref: b.entrada || null });
      mostrarResultado(p, b);
    }
  }
}

// ---------- Resultado ----------
let audioCtx = null;
function alertaSonora(tipo) {
  try {
    navigator.vibrate?.(tipo === 'encargo' || tipo === 'placa' ? [250, 120, 250, 120, 250] : [150]);
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const tonos = tipo === 'encargo' || tipo === 'placa' ? [880, 660, 880] : tipo === 'prueba' ? [523, 784] : [660, 660];
    tonos.forEach((fq, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = fq; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + i * 0.18; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.start(t); o.stop(t + 0.17);
    });
  } catch {}
}

const dias = (iso) => { if (!iso) return null; const t = Date.parse(iso + 'T12:00:00'); return isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000)); };
const textoDias = (d) => d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;

/** Línea de confianza: qué tan respaldada y reciente es la información. */
function lineaConfianza(n, e) {
  let pct, txt;
  if (n === 'encargo' || n === 'placa') {
    const d = dias(e.fv);
    pct = d === null ? 60 : d <= 7 ? 100 : d <= 30 ? 75 : 45;
    txt = 'Fuente oficial · ' + (d === null ? 'fecha de verificación no registrada' : 'verificado ' + textoDias(d));
    if (d !== null && d > 30) txt += ' · conviene volver a verificar';
  } else {
    const d = dias(e.f);
    pct = e.sf || d === null ? 15 : d <= 7 ? 40 : 28;
    txt = 'Reporte vecinal sin verificación oficial · ' + (e.sf || d === null ? 'antiguo, sin fecha' : 'reportado ' + textoDias(d));
  }
  return `<div class="confianza"><div class="barra"><i style="width:${pct}%;background:${COLOR[n]}"></i></div><span>${esc(txt)}</span></div>`;
}

function datosVehiculo(e) {
  const v = [e.ma, e.mo, e.co].filter(Boolean).map(esc).join(' · ');
  return v ? `<div class="vehiculo">Vehículo registrado: <b>${v}</b></div>` : '';
}

function mostrarResultado(p, b) {
  const el = $('#resultado'); el.className = 'show ' + b.tipo;
  const e = b.entrada, n = e ? nivelDe(e) : null;
  let titulo, detalle = '', extra = '', acciones = '';
  const verif = `<a class="btn" href="https://www.autoseguro.gob.cl/" target="_blank" rel="noopener" data-copiar="${p}">🔎 Verificar oficial</a>`;
  const fUrl = urlFormulario(p);
  const informar = fUrl ? `<a class="btn ghost" href="${esc(fUrl)}" target="_blank" rel="noopener">✉ Informar cambio</a>` : '';

  if (b.tipo === 'encargo') {
    titulo = '🔴 Encargo por robo vigente (fuente oficial)';
    detalle = 'No intervengas ni confrontes. Toma distancia y llama al 133 con la patente y la ubicación.';
    extra = datosVehiculo(e) + lineaConfianza(n, e);
    acciones = '<a class="btn rojo" href="tel:133">📞 Llamar 133</a>' + verif + informar;
  } else if (b.tipo === 'placa') {
    const cual = e.ps === 'Ambas' ? 'ambas placas' : e.ps === 'Delantera' ? 'la placa delantera' : e.ps === 'Trasera' ? 'la placa trasera' : 'placas';
    titulo = '🟣 Placa sustraída (fuente oficial)';
    detalle = `El vehículo original no tiene encargo, pero ${cual} figura${e.ps === 'Ambas' ? 'n' : ''} como robada${e.ps === 'Ambas' ? 's' : ''}. ` +
      'Compara sin acercarte: <b>¿coinciden marca, modelo y color?</b> <b>¿la placa delantera y la trasera tienen el mismo número?</b> ' +
      'Si algo no calza, llama al 133.';
    extra = datosVehiculo(e) + lineaConfianza(n, e);
    acciones = verif + '<a class="btn rojo" href="tel:133">📞 Llamar 133</a>' + informar;
  } else if (b.tipo === 'vecinal') {
    titulo = '🟠 Coincide con un reporte vecinal';
    detalle = 'Aún no está verificado en fuente oficial. Verifícalo antes de concluir nada y no intervengas.';
    extra = datosVehiculo(e) + lineaConfianza(n, e);
    acciones = verif + '<a class="btn" href="tel:133">📞 Llamar 133</a>' + informar;
  } else if (b.tipo === 'posible') {
    const ref = { encargo: 'un encargo oficial', placa: 'una placa sustraída', vecinal: 'un reporte vecinal', prueba: 'una patente de prueba' }[n] || 'un registro';
    titulo = 'Posible coincidencia: revisa la patente';
    detalle = `Se leyó <b>${esc(p)}</b>, muy parecida a <b>${esc(e.p)}</b> (${ref}). Puede ser un error de lectura: mira la placa con tus ojos antes de concluir nada.`;
    acciones = `<a class="btn" href="https://www.autoseguro.gob.cl/" target="_blank" rel="noopener" data-copiar="${esc(e.p)}">Verificar ${esc(e.p)}</a>`;
  } else if (b.tipo === 'prueba') {
    titulo = '🔵 Patente de prueba reconocida';
    detalle = 'La lectura y el cotejo funcionan correctamente.';
  } else {
    titulo = 'Sin reportes en la base vecinal';
    detalle = base ? 'Esto no descarta un encargo oficial. Si tienes dudas, verifica en fuente oficial.' : 'Aún no hay base cargada: configúrala en ⚙.';
    acciones = verif + informar;
  }
  if (b.tipo !== 'prueba' && typeof botonModeracion === 'function') acciones += botonModeracion(p);
  el.innerHTML = `<div class="placa">${esc(p)}</div><div class="titulo">${titulo}</div><div class="detalle">${detalle}</div>${extra}` +
    (acciones ? `<div class="acciones">${acciones}</div>` : '');
  if (b.tipo !== 'sin') alertaSonora(b.tipo);
}

document.addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-copiar]');
  if (a) { navigator.clipboard?.writeText(a.dataset.copiar).then(() => toast('Patente copiada: pégala en el sitio')).catch(() => {}); }
});

// ---------- Historial (bitácora de pruebas) ----------
let historial = leerLS(LS.hist, []);
function registrar(x) {
  historial.unshift({ id: Date.now() + Math.random(), ts: Date.now(), correcta: null, real: '', ...x });
  historial = historial.slice(0, 300); guardarLS(LS.hist, historial); pintarHistorial();
}

const ETIQ = { encargo: 'Encargo', placa: 'Placa sustraída', vecinal: 'Reporte vecinal', reporte: 'Reporte', posible: 'Revisar', prueba: 'Prueba', sin: 'Sin reporte' };
function pintarHistorial() {
  const ul = $('#historial'); ul.innerHTML = '';
  $('#historialVacio').hidden = historial.length > 0;
  for (const h of historial.slice(0, 60)) {
    const li = document.createElement('li'); li.dataset.id = h.id;
    li.innerHTML = `<span class="p">${h.leida}</span>
      <span class="m">${fechaHora(h.ts)} · ${h.modo}${h.conf ? ' · ' + Math.round(h.conf * 100) + '%' : ''}</span>
      <span class="tag ${h.resultado}">${ETIQ[h.resultado] || ''}</span>
      <span class="eval"><button class="si ${h.correcta === true ? 'on' : ''}" data-ev="si" aria-label="Lectura correcta">✓</button>
      <button class="no ${h.correcta === false ? 'on' : ''}" data-ev="no" aria-label="Lectura incorrecta">✗</button></span>
      ${h.correcta === false ? `<form class="real"><input placeholder="Patente real" value="${h.real || ''}" maxlength="8"><button>OK</button></form>` : ''}`;
    ul.appendChild(li);
  }
}

$('#historial').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ev]'); if (!b) return;
  const h = historial.find((x) => String(x.id) === ev.target.closest('li').dataset.id); if (!h) return;
  if (b.dataset.ev === 'si') { h.correcta = h.correcta === true ? null : true; h.real = h.correcta ? h.leida : ''; }
  else { h.correcta = h.correcta === false ? null : false; h.real = ''; }
  guardarLS(LS.hist, historial); pintarHistorial();
  if (h.correcta === false) $(`li[data-id="${h.id}"] .real input`)?.focus();
});
$('#historial').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const li = ev.target.closest('li'), h = historial.find((x) => String(x.id) === li.dataset.id);
  if (h) { h.real = limpiar(ev.target.querySelector('input').value); guardarLS(LS.hist, historial); toast('Guardado'); }
});

$('#btnCopiar').addEventListener('click', async () => {
  // Columnas A:C de la hoja "Lecturas": Fecha y hora | Patente leída | Patente real
  const filas = historial.filter((h) => h.correcta !== null).slice().reverse()
    .map((h) => [fechaHora(h.ts), h.leida, h.correcta ? h.leida : h.real].join('\t'));
  if (!filas.length) { toast('Marca primero ✓ o ✗ en las lecturas'); return; }
  try { await navigator.clipboard.writeText(filas.join('\n')); toast(`${filas.length} filas copiadas: pégalas en la columna A de "Lecturas"`, 4000); }
  catch { toast('No se pudo copiar'); }
});
$('#btnBorrar').addEventListener('click', () => {
  if (!historial.length) return;
  if (confirm('¿Borrar todas las lecturas de esta sesión?')) { historial = []; guardarLS(LS.hist, historial); pintarHistorial(); }
});

// ---------- Foto ----------
async function analizarFoto(fuente, R) {
  await cargarMotor();
  estadoMotor('Analizando…');
  const lect = await analizar(fuente, R);
  procesarLecturas(lect, 'Foto');
  estadoMotor('');
  if (!lect.length) toast('No se encontró ninguna patente. Acércate o mejora la luz.', 3500);
  else if (!lect.some((l) => l.valida)) toast('Se vio una placa, pero no se pudo leer con seguridad.', 3500);
  return lect;
}

$('#btnFoto').addEventListener('click', async () => {
  if (enVivo && video.readyState >= 2) {
    const R = regionVisible(); const lect = await analizarFoto(video, R); dibujarCajas(R, lect);
  } else $('#archivo').click();
});

$('#archivo').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  const img = await createImageBitmap(f);
  // Mostrar la foto en el recuadro (modo "contener")
  $('#camaraMsg').hidden = true; ajustarOverlay();
  const cw = overlay.clientWidth, ch = overlay.clientHeight, s = Math.min(cw / img.width, ch / img.height);
  const R = { x: 0, y: 0, w: img.width, h: img.height };
  const lect = await analizarFoto(img, R);
  octx.clearRect(0, 0, cw, ch);
  const ox = (cw - img.width * s) / 2, oy = (ch - img.height * s) / 2;
  octx.drawImage(img, ox, oy, img.width * s, img.height * s);
  for (const l of lect) {
    const color = colorLectura(l);
    octx.lineWidth = 3; octx.strokeStyle = color;
    octx.strokeRect(ox + l.caja.x1 * s, oy + l.caja.y1 * s, (l.caja.x2 - l.caja.x1) * s, (l.caja.y2 - l.caja.y1) * s);
  }
});

// ---------- Consulta manual ----------
$('#manual').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const t = limpiar($('#txtManual').value); if (!t) return;
  const n = normalizarChilena(t); const p = n && n.cambios === 0 ? n.texto : t;
  const b = buscar(p);
  registrar({ leida: p, conf: 0, modo: 'Manual', resultado: b.tipo, ref: b.entrada || null });
  mostrarResultado(p, b); $('#txtManual').value = '';
});

// ---------- Zoom y linterna ----------
document.querySelectorAll('.zoom button[data-z]').forEach((b) => b.addEventListener('click', () => {
  zoom = parseFloat(b.dataset.z);
  document.querySelectorAll('.zoom button[data-z]').forEach((x) => x.classList.toggle('on', x === b));
  video.style.transform = `scale(${zoom})`;
}));
$('#btnLinterna').addEventListener('click', async () => {
  const track = stream?.getVideoTracks()[0]; if (!track) return;
  linterna = !linterna;
  try { await track.applyConstraints({ advanced: [{ torch: linterna }] }); } catch { toast('Linterna no disponible'); }
});

// ---------- Configuración ----------
const dlg = $('#dlgConfig');
function abrirConfig() {
  const cfg = leerLS(LS.config, {});
  $('#cfgUrl').value = cfg.url || ''; $('#cfgClave').value = cfg.clave || ''; $('#cfgMod').value = cfg.mod || '';
  $('#cfgInfo').textContent = base ? `Base actual: ${base.patentes.length} registros, descargada ${hace(base.ts)}.`
    : 'La URL y la clave quedan guardadas solo en este teléfono.';
  dlg.showModal();
}
$('#btnConfig').addEventListener('click', abrirConfig);
$('#estadoBase').addEventListener('click', abrirConfig);
$('#cfgCancelar').addEventListener('click', () => dlg.close());
$('#frmConfig').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const prev = leerLS(LS.config, {}), mod = $('#cfgMod').value.trim();
  guardarLS(LS.config, { url: $('#cfgUrl').value.trim(), clave: $('#cfgClave').value.trim(),
    mod, modNombre: mod && mod === prev.mod ? prev.modNombre : '' });
  $('#cfgInfo').textContent = 'Descargando…';
  if (await actualizarBase()) {
    if (typeof refrescarModerador === 'function') await refrescarModerador();
    dlg.close();
  } else $('#cfgInfo').textContent = 'No se pudo descargar. Revisa la URL y la clave.';
});

// ---------- Inicio ----------
indexar(); pintarHistorial();
setInterval(pintarEstadoBase, 60000);
if (navigator.onLine) actualizarBase(true);
if (!leerLS(LS.config, null)) setTimeout(abrirConfig, 400);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && navigator.onLine && (!base || Date.now() - base.ts > 10 * 60000)) actualizarBase(true);
});
if ('serviceWorker' in navigator) {
  const habiaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Al publicar una versión nueva, recargar una vez para usarla
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (habiaControlador) location.reload(); });
}
window.__lp = { normalizarChilena, buscar, analizar, cargarMotor }; // para pruebas
