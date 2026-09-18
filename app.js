(function () {
  'use strict';

  const qs = (id) => document.getElementById(id);

  // Screens
  const startScreen = qs('start-screen');
  const scanScreen = qs('scan-screen');
  const doneScreen = qs('done-screen');

  // Start screen
  const startBtn = qs('start-btn');
  const resumeBanner = qs('resume-banner');
  const resumeCount = qs('resume-count');
  const resumeBtn = qs('resume-btn');
  const discardBtn = qs('discard-btn');

  // Scan screen
  const statLines = qs('stat-lines');
  const statUnits = qs('stat-units');
  const completeBtn = qs('complete-btn');
  const feedbackBanner = qs('feedback-banner');
  const feedbackEan = qs('feedback-ean');
  const feedbackMsg = qs('feedback-msg');
  const scanInput = qs('scan-input');
  const manualToggle = qs('manual-toggle');
  const manualForm = qs('manual-form');
  const manualInput = qs('manual-input');
  const manualAddBtn = qs('manual-add-btn');
  const tableBody = qs('scan-table-body');
  const emptyState = qs('empty-state');
  const cameraScanBtn = qs('camera-scan-btn');
  const cameraOverlay = qs('camera-overlay');
  const cameraVideo = qs('camera-video');
  const cameraFlash = qs('camera-flash');
  const cameraStatus = qs('camera-status');
  const cameraCloseBtn = qs('camera-close-btn');

  // Done screen
  const doneSummary = qs('done-summary');
  const newStocktakeBtn = qs('new-stocktake-btn');

  // Confirm overlay
  const confirmOverlay = qs('confirm-overlay');
  const confirmMessage = qs('confirm-message');
  const confirmCancelBtn = qs('confirm-cancel');
  const confirmOkBtn = qs('confirm-ok');

  const SESSION_KEY = 'stocktake_session_v1';
  const EAN_RE = /^\d{6,14}$/;

  /** @type {Map<string, number>} EAN -> quantity, insertion-ordered */
  const items = new Map();
  /** @type {Map<string, {tr: HTMLTableRowElement, qtyVal: HTMLElement}>} */
  const rowRefs = new Map();

  let confirmCallback = null;
  let manualOpen = false;
  let audioCtx = null;

  completeBtn.disabled = true;

  // ---------- Screen switching ----------
  function showScreen(el) {
    for (const s of [startScreen, scanScreen, doneScreen]) s.classList.add('hidden');
    el.classList.remove('hidden');
  }

  // ---------- Audio feedback ----------
  function ensureAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function beep(freq, durationMs, type) {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  }

  const successBeep = () => beep(1000, 90, 'sine');
  const errorBeep = () => beep(220, 220, 'square');

  // ---------- Persistence ----------
  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ items: Array.from(items.entries()) }));
    } catch (e) { /* localStorage unavailable - continue without persistence */ }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items)) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- Rendering ----------
  function flashRow(tr) {
    tr.classList.remove('row-flash');
    void tr.offsetWidth; // restart CSS animation
    tr.classList.add('row-flash');
  }

  function renderRow(ean, qty, flash) {
    let ref = rowRefs.get(ean);
    if (!ref) {
      const tr = document.createElement('tr');

      const tdEan = document.createElement('td');
      tdEan.className = 'ean-cell';
      tdEan.textContent = ean;

      const tdQty = document.createElement('td');
      const controls = document.createElement('div');
      controls.className = 'qty-controls';

      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'qty-btn';
      minusBtn.textContent = '−';
      minusBtn.addEventListener('click', () => adjustQty(ean, -1));

      const qtyVal = document.createElement('span');
      qtyVal.className = 'qty-value';
      qtyVal.textContent = String(qty);

      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'qty-btn';
      plusBtn.textContent = '+';
      plusBtn.addEventListener('click', () => adjustQty(ean, 1));

      controls.append(minusBtn, qtyVal, plusBtn);
      tdQty.appendChild(controls);

      const tdRemove = document.createElement('td');
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'row-remove';
      removeBtn.title = 'Remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => removeRow(ean));
      tdRemove.appendChild(removeBtn);

      tr.append(tdEan, tdQty, tdRemove);
      tableBody.appendChild(tr);
      ref = { tr, qtyVal };
      rowRefs.set(ean, ref);
      emptyState.classList.add('hidden');
    } else {
      ref.qtyVal.textContent = String(qty);
    }
    if (flash) {
      flashRow(ref.tr);
      ref.tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function updateStats() {
    let units = 0;
    for (const q of items.values()) units += q;
    statLines.textContent = String(items.size);
    statUnits.textContent = String(units);
    completeBtn.disabled = items.size === 0;
  }

  function announce(success, ean, msg) {
    feedbackBanner.classList.remove('feedback-idle', 'feedback-success', 'feedback-error');
    feedbackBanner.classList.add(success ? 'feedback-success' : 'feedback-error');
    feedbackEan.textContent = ean;
    feedbackMsg.textContent = msg;
  }

  // ---------- Core scan handling ----------
  function processScan(raw) {
    const value = (raw || '').trim();
    if (!value) return;
    if (!EAN_RE.test(value)) {
      announce(false, value, "Doesn't look like a valid EAN (digits only, 6–14 long) — not added.");
      errorBeep();
      return;
    }
    const isNew = !items.has(value);
    const qty = (items.get(value) || 0) + 1;
    items.set(value, qty);
    renderRow(value, qty, true);
    announce(true, value, isNew ? 'New item — added to list' : `Already scanned — now ${qty}`);
    successBeep();
    updateStats();
    saveSession();
  }

  function adjustQty(ean, delta) {
    const cur = items.get(ean);
    if (cur === undefined) return;
    const next = cur + delta;
    if (next <= 0) {
      removeRow(ean);
      return;
    }
    items.set(ean, next);
    const ref = rowRefs.get(ean);
    if (ref) ref.qtyVal.textContent = String(next);
    updateStats();
    saveSession();
    scanInput.focus();
  }

  function removeRow(ean) {
    items.delete(ean);
    const ref = rowRefs.get(ean);
    if (ref) {
      ref.tr.remove();
      rowRefs.delete(ean);
    }
    if (items.size === 0) emptyState.classList.remove('hidden');
    updateStats();
    saveSession();
    scanInput.focus();
  }

  function resetAll() {
    items.clear();
    rowRefs.clear();
    tableBody.innerHTML = '';
    emptyState.classList.remove('hidden');
    feedbackBanner.classList.remove('feedback-success', 'feedback-error');
    feedbackBanner.classList.add('feedback-idle');
    feedbackEan.textContent = 'Ready to scan…';
    feedbackMsg.textContent = 'Aim the scanner and pull the trigger';
    updateStats();
  }

  function restoreSession(data) {
    for (const [ean, qty] of data.items) {
      items.set(ean, qty);
      renderRow(ean, qty, false);
    }
    updateStats();
  }

  // ---------- Scanner input capture ----------
  // Barcode scanners act as keyboards: they type each digit fast, then send a
  // terminator (Enter by default on virtually every scanner). We submit on
  // Enter/Tab, plus a short debounce fallback for scanners configured with no
  // terminator at all.
  let scanDebounce = null;

  function trySubmitScan() {
    const raw = scanInput.value;
    scanInput.value = '';
    if (!raw.trim()) return;
    processScan(raw);
  }

  scanInput.addEventListener('input', () => {
    clearTimeout(scanDebounce);
    scanDebounce = setTimeout(trySubmitScan, 80);
  });

  scanInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      clearTimeout(scanDebounce);
      trySubmitScan();
    }
  });

  // Keep the scanner input focused so keystrokes from the scanner always land
  // somewhere useful, without stealing focus from other controls.
  document.addEventListener('click', (e) => {
    if (scanScreen.classList.contains('hidden')) return;
    if (!confirmOverlay.classList.contains('hidden')) return;
    if (e.target.closest('input, button, a, textarea')) return;
    scanInput.focus();
  });

  window.addEventListener('focus', () => {
    if (!scanScreen.classList.contains('hidden') &&
        confirmOverlay.classList.contains('hidden') &&
        !manualOpen) {
      scanInput.focus();
    }
  });

  // ---------- Manual entry ----------
  function submitManual() {
    const val = manualInput.value;
    manualInput.value = '';
    processScan(val);
    manualInput.focus();
  }

  manualToggle.addEventListener('click', () => {
    manualOpen = !manualOpen;
    manualForm.classList.toggle('hidden', !manualOpen);
    manualToggle.textContent = manualOpen ? '− Hide manual entry' : '+ Enter an EAN manually';
    if (manualOpen) manualInput.focus(); else scanInput.focus();
  });

  manualAddBtn.addEventListener('click', submitManual);
  manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitManual();
    }
  });

  // ---------- Camera scanning ----------
  // Uses the native Shape Detection API (BarcodeDetector), available in
  // Chromium-based browsers and Android WebView — no bundled library
  // needed. Where it's unsupported (Firefox, Safari) the button stays
  // hidden and the keyboard-wedge/manual paths above are unaffected.
  let cameraStream = null;
  let barcodeDetector = null;
  let cameraScanTimer = null;
  let cameraScanBusy = false;
  let lastCameraValue = null;
  let lastCameraValueAt = 0;

  function cameraSupported() {
    return 'BarcodeDetector' in window &&
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  if (cameraSupported()) {
    cameraScanBtn.classList.remove('hidden');
  }

  async function openCameraScanner() {
    cameraOverlay.classList.remove('hidden');
    cameraStatus.textContent = 'Starting camera…';
    try {
      if (!barcodeDetector) {
        try {
          barcodeDetector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        } catch (e) {
          barcodeDetector = new BarcodeDetector();
        }
      }
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      cameraVideo.srcObject = cameraStream;
      await cameraVideo.play();
      cameraStatus.textContent = 'Point the camera at a barcode';
      lastCameraValue = null;
      cameraScanTimer = setInterval(scanCameraFrame, 200);
    } catch (err) {
      cameraStatus.textContent = 'Camera unavailable — check camera permission and try again.';
    }
  }

  function closeCameraScanner() {
    if (cameraScanTimer) {
      clearInterval(cameraScanTimer);
      cameraScanTimer = null;
    }
    if (cameraStream) {
      for (const track of cameraStream.getTracks()) track.stop();
      cameraStream = null;
    }
    cameraVideo.srcObject = null;
    cameraOverlay.classList.add('hidden');
  }

  function triggerCameraFlash(cls) {
    cameraFlash.classList.remove('flash-success', 'flash-error');
    void cameraFlash.offsetWidth; // restart CSS animation
    cameraFlash.classList.add(cls);
  }

  function handleCameraDetection(rawValue) {
    const value = rawValue.trim();
    const wasValid = EAN_RE.test(value);
    processScan(value);
    if (wasValid) {
      cameraStatus.textContent = `Added ${value} — now ${items.get(value)}`;
      triggerCameraFlash('flash-success');
    } else {
      cameraStatus.textContent = `"${value}" doesn't look like a valid EAN — ignored`;
      triggerCameraFlash('flash-error');
    }
  }

  async function scanCameraFrame() {
    if (cameraScanBusy || !cameraStream) return;
    cameraScanBusy = true;
    try {
      const codes = await barcodeDetector.detect(cameraVideo);
      if (codes && codes.length > 0) {
        const value = (codes[0].rawValue || '').trim();
        const now = Date.now();
        if (value && !(value === lastCameraValue && now - lastCameraValueAt < 1500)) {
          lastCameraValue = value;
          lastCameraValueAt = now;
          handleCameraDetection(value);
        }
      }
    } catch (e) {
      // Transient detection errors (motion blur, nothing in frame) are
      // normal — ignore and keep trying on the next tick.
    } finally {
      cameraScanBusy = false;
    }
  }

  cameraScanBtn.addEventListener('click', openCameraScanner);
  cameraCloseBtn.addEventListener('click', closeCameraScanner);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !cameraOverlay.classList.contains('hidden')) {
      closeCameraScanner();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) closeCameraScanner();
  });

  // ---------- Confirm overlay ----------
  function openConfirm(message, onConfirm) {
    confirmMessage.textContent = message;
    confirmCallback = onConfirm;
    confirmOverlay.classList.remove('hidden');
  }

  function closeConfirm() {
    confirmOverlay.classList.add('hidden');
    confirmCallback = null;
  }

  confirmCancelBtn.addEventListener('click', () => {
    closeConfirm();
    if (!scanScreen.classList.contains('hidden')) scanInput.focus();
  });

  confirmOkBtn.addEventListener('click', () => {
    const cb = confirmCallback;
    closeConfirm();
    if (cb) cb();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !confirmOverlay.classList.contains('hidden')) {
      closeConfirm();
    }
  });

  // ---------- Export ----------
  function formatTimestamp(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function exportSpreadsheet() {
    const sorted = Array.from(items.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true })
    );
    const rows = [['EAN', 'Quantity'], ...sorted];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Force the EAN column to text so Excel doesn't strip leading zeros or
    // mangle long numbers into scientific notation.
    for (let r = 1; r <= sorted.length; r++) {
      const cellRef = XLSX.utils.encode_cell({ r, c: 0 });
      if (ws[cellRef]) {
        ws[cellRef].t = 's';
        ws[cellRef].z = '@';
      }
    }
    ws['!cols'] = [{ wch: 18 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock Take');
    const filename = `stocktake_${formatTimestamp(new Date())}.xlsx`;

    // Inside the Android wrapper app, a blob: download from a WebView has
    // nowhere to go — hand the bytes to the native side instead, which
    // writes them straight to the device's Downloads folder.
    if (window.AndroidStockTake && window.AndroidStockTake.saveXlsx) {
      const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      window.AndroidStockTake.saveXlsx(base64, filename);
    } else {
      XLSX.writeFile(wb, filename);
    }
    return filename;
  }

  function finishStockTake() {
    closeCameraScanner();
    const lines = items.size;
    let units = 0;
    for (const q of items.values()) units += q;
    const filename = exportSpreadsheet();
    resetAll();
    clearSession();
    doneSummary.textContent =
      `${lines} EAN${lines === 1 ? '' : 's'}, ${units} unit${units === 1 ? '' : 's'} — saved as ${filename}`;
    showScreen(doneScreen);
  }

  completeBtn.addEventListener('click', () => {
    if (items.size === 0) return;
    let units = 0;
    for (const q of items.values()) units += q;
    openConfirm(
      `Finish stock take with ${items.size} EAN${items.size === 1 ? '' : 's'} / ${units} unit${units === 1 ? '' : 's'}? ` +
      'This downloads the spreadsheet and clears the list.',
      finishStockTake
    );
  });

  // ---------- Start / resume / done ----------
  startBtn.addEventListener('click', () => {
    ensureAudioCtx();
    showScreen(scanScreen);
    scanInput.focus();
  });

  resumeBtn.addEventListener('click', () => {
    const saved = loadSession();
    if (saved) restoreSession(saved);
    ensureAudioCtx();
    showScreen(scanScreen);
    scanInput.focus();
  });

  discardBtn.addEventListener('click', () => {
    clearSession();
    refreshResumeBanner();
  });

  newStocktakeBtn.addEventListener('click', () => {
    refreshResumeBanner();
    showScreen(startScreen);
  });

  // ---------- Init ----------
  function refreshResumeBanner() {
    const saved = loadSession();
    if (saved && saved.items.length > 0) {
      resumeCount.textContent = String(saved.items.length);
      resumeBanner.classList.remove('hidden');
    } else {
      resumeBanner.classList.add('hidden');
    }
  }

  (function init() {
    refreshResumeBanner();
    updateStats();
  })();
})();
