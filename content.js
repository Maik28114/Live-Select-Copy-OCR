let overlay, selectionBox, selecting = false, startX = 0, startY = 0;
let stream = null, videoEl = null, canvasEl = null, ctx = null;
let consent = false;

let tesseractReady = false;
let tesseractWorker = null;

const contextMenu = document.createElement('div');
Object.assign(contextMenu.style, {
  position: 'fixed', background: '#fff', border: '1px solid #888',
  padding: '6px 8px', zIndex: 2147483646, boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  display: 'none', fontFamily: 'Arial, sans-serif', fontSize: '13px', userSelect: 'none'
});
document.body.appendChild(contextMenu);

function setContextMenu(text, x, y) {
  contextMenu.innerHTML = '';
  const copy = document.createElement('div');
  copy.textContent = 'Kopieren';
  copy.style.cursor = 'pointer';
  copy.onclick = async () => {
    await navigator.clipboard.writeText(text || '');
    contextMenu.style.display = 'none';
    alert('Text kopiert');
  };
  contextMenu.appendChild(copy);
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.display = 'block';
}

// --- Einwilligungs-Popup ---
function showConsentPopup(onAccept) {
  const modal = document.createElement('div');
  modal.style.position = 'fixed';
  modal.style.top = '50%';
  modal.style.left = '50%';
  modal.style.transform = 'translate(-50%, -50%)';
  modal.style.zIndex = '9999';
  modal.style.background = '#fff';
  modal.style.padding = '2em';
  modal.style.borderRadius = '0.5em';
  modal.style.boxShadow = '0 2px 10px #0003';
  modal.style.maxWidth = '400px';
  modal.innerHTML = `
    <p style="margin-bottom: 1em; font-weight: bold;">
      Mit Klick auf OK bestätigst du, dass alle Teilnehmenden der Texterkennung im Video/Screen zugestimmt haben.
    </p>
    <button id="ocrok" style="margin-right: 1em;">OK</button>
    <button id="ocrcancel">Abbrechen</button>
  `;
  document.body.appendChild(modal);
  document.getElementById('ocrok').onclick = () => {
    modal.remove();
    consent = true;
    if (onAccept) onAccept();
  };
  document.getElementById('ocrcancel').onclick = () => {
    modal.remove();
  };
}

// -- Worker- und OCR-Initialisierung (Manifest V3 kompatibel) --
async function ensureTesseract() {
  if (tesseractReady) return;
  const T = await loadTesseract();
  // Pfade zu Worker und WASM generieren
  const workerPath = chrome.runtime.getURL('tesseract/worker.min.js');
  const corePath = chrome.runtime.getURL('tesseract/tesseract-core.wasm.js');

  // NEU: MV3 & ES-Modul (wenn unterstützt - ab Tesseract.js 4+)
  try {
    tesseractWorker = await T.createWorker({
      workerPath,
      corePath,
      logger: m => console.log('[OCR]', m)
    });
    await tesseractWorker.loadLanguage('deu+eng');
    await tesseractWorker.initialize('deu+eng');
    tesseractReady = true;
  } catch (err) {
    alert("Fehler beim OCR-Worker: " + err.message);
    tesseractReady = false;
  }
}

async function terminateTesseract() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
    tesseractReady = false;
  }
}

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: 2147483645, cursor: 'crosshair',
    background: 'transparent'
  });
  document.body.appendChild(overlay);
  overlay.addEventListener('mousedown', onDown);
  overlay.addEventListener('mousemove', onMove);
  overlay.addEventListener('mouseup', onUp);
  overlay.addEventListener('contextmenu', e => e.preventDefault());
}

async function startCaptureIfNeeded() {
  if (stream) return;
  stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  videoEl = document.createElement('video');
  videoEl.srcObject = stream;
  await videoEl.play();
  canvasEl = document.createElement('canvas');
  ctx = canvasEl.getContext('2d', { willReadFrequently: true });
}

function onDown(e) {
  if (!consent) { alert('Bitte zuerst Einwilligung erteilen.'); return; }
  selecting = true;
  startX = e.clientX; startY = e.clientY;
  selectionBox = document.createElement('div');
  Object.assign(selectionBox.style, {
    position: 'fixed', border: '2px dashed #0a84ff', background: 'rgba(10,132,255,0.15)',
    left: startX + 'px', top: startY + 'px', zIndex: 2147483647
  });
  document.body.appendChild(selectionBox);
}

function onMove(e) {
  if (!selecting || !selectionBox) return;
  const x = Math.min(startX, e.clientX);
  const y = Math.min(startY, e.clientY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);
  Object.assign(selectionBox.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
}

async function onUp(e) {
  if (!selecting) return;
  selecting = false;
  const rect = selectionBox.getBoundingClientRect();
  selectionBox.remove(); selectionBox = null;

  await startCaptureIfNeeded();
  await ensureTesseract();

  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

  const scaleX = canvasEl.width / window.innerWidth;
  const scaleY = canvasEl.height / window.innerHeight;
  const sx = Math.max(0, Math.floor(rect.left * scaleX));
  const sy = Math.max(0, Math.floor(rect.top * scaleY));
  const sw = Math.max(1, Math.floor(rect.width * scaleX));
  const sh = Math.max(1, Math.floor(rect.height * scaleY));

  const crop = document.createElement('canvas');
  crop.width = sw; crop.height = sh;
  const cctx = crop.getContext('2d', { willReadFrequently: true });
  cctx.drawImage(canvasEl, sx, sy, sw, sh, 0, 0, sw, sh);

  preprocess(crop, { grayscale: true, contrast: 1.2, binarize: true, threshold: 180 });

  showProgress(e.clientX, e.clientY, 'Erkenne Text …');
  const dataUrl = crop.toDataURL('image/png');
  const text = await runOCRPersistent(dataUrl);
  hideProgress();

  setContextMenu(text || '', e.clientX, e.clientY);
}

let progressEl = null;
function showProgress(x, y, msg) {
  if (!progressEl) {
    progressEl = document.createElement('div');
    Object.assign(progressEl.style, {
      position: 'fixed', padding: '6px 8px', background: '#000', color: '#fff', borderRadius: '4px',
      zIndex: 2147483647, fontSize: '12px', opacity: 0.9
    });
    document.body.appendChild(progressEl);
  }
  progressEl.textContent = msg;
  progressEl.style.left = x + 'px'; progressEl.style.top = (y + 14) + 'px';
  progressEl.style.display = 'block';
}
function hideProgress() { if (progressEl) progressEl.style.display = 'none'; }

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  const base = chrome.runtime.getURL('tesseract/');
  await import(base + 'tesseract.min.js');
  return window.Tesseract;
}

async function runOCRPersistent(dataUrl) {
  if (!tesseractReady) await ensureTesseract();
  try {
    const { data: { text } } = await tesseractWorker.recognize(dataUrl);
    return text;
  } catch (err) {
    alert("Fehler beim OCR: " + err.message);
    return "";
  }
}

function preprocess(canvas, opts) {
  const ctxp = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctxp.getImageData(0, 0, w, h);
  const d = img.data;

  if (opts.grayscale) {
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
  }
  if (opts.contrast && opts.contrast !== 1) {
    const c = opts.contrast;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.max(0, Math.min(255, (d[i] - 128) * c + 128));
      d[i + 1] = d[i];
      d[i + 2] = d[i];
    }
  }
  if (opts.binarize) {
    const t = opts.threshold ?? 160;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] > t ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctxp.putImageData(img, 0, 0);
}

// --- Tastenkombination für Overlay/Aktivierung ---
window.addEventListener('keydown', e => {
  if (e.shiftKey && e.altKey && e.code === 'KeyO') {
    if (!consent) {
      showConsentPopup(() => {
        ensureOverlay();
        alert('Overlay aktiv: Bereich ziehen, OCR mit persistentem Worker.');
      });
    } else {
      if (!overlay) {
        ensureOverlay();
        alert('Overlay aktiv: Bereich ziehen, OCR mit persistentem Worker.');
      } else {
        overlay.remove(); overlay = null;
        contextMenu.style.display = 'none';
      }
    }
  }
});

window.addEventListener('beforeunload', () => { terminateTesseract(); });
