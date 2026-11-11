/* TTS Studio — whole-project queue.
   Load a game's dub index (e.g. https://YOU.github.io/the-way/dub/en/index.json), then generate every batch it lists,
   one line at a time, in order. Recordings are stored in this browser (the same store the single-batch screen uses),
   so the queue can be stopped and resumed at any time, even after closing the app. "Export new" packs only the
   recordings made since the last export, in ZIP parts of a size a phone can handle, laid out as audio/<lang>/<id>.mp3.
   Uses settings(), headers(), dbGet(), dbPut(), safeFilename(), showToast(), testConnection() and parseBatch() from app.js. */
(function () {
  const P = {
    index: null, url: '', lang: 'en', batches: [], cache: new Map(), running: false, stop: false,
    partBytes: 35 * 1024 * 1024,
  };
  const LS_URL = 'tts_index_url', LS_EXPORTED = 'tts_exported_ids', LS_SKIP = 'tts_skip_live', LS_REDO = 'tts_redo_ids';
  const redo = () => { try { return new Set(JSON.parse(localStorage.getItem(LS_REDO) || '[]')); } catch { return new Set(); } };
  const saveRedo = (set) => localStorage.setItem(LS_REDO, JSON.stringify(Array.from(set)));

  // ---------- pronunciation ----------
  // The voice profiles (from /api/voices) give each tag its usual direction; the guide (pronounce.json next to the
  // index) says how names should sound. For each line, only the names it contains are added to that direction.
  const PR = { cast: null, names: {}, re: null };
  async function loadCast() {
    if (PR.cast) return PR.cast;
    try { const r = await fetch(settings().base + '/api/voices', { headers: headers() }); if (r.ok) PR.cast = (await r.json()).cast || null; } catch { PR.cast = null; }
    return PR.cast;
  }
  async function loadGuide(idx) {
    PR.names = {}; PR.re = null;
    const file = idx.pronunciation || 'pronounce.json';
    try {
      const r = await fetch(baseOf(P.url) + file, { cache: 'no-store' });
      if (!r.ok) return 0;
      const g = await r.json();
      PR.names = g.names || g;
      const keys = Object.keys(PR.names).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      PR.re = keys.length ? new RegExp('\\b(' + keys.join('|') + ')(?![a-z])', 'g') : null;
      return keys.length;
    } catch { return 0; }
  }
  // Called for every line, by this queue and by the single-batch screen (app.js).
  window.ttsInstructions = function (item) {
    if (!PR.re || !item || !item.text) return '';
    const found = [...new Set((item.text.match(PR.re) || []))];
    if (!found.length) return '';
    const tag = String(item.voice || 'N').toUpperCase();
    const base = (PR.cast && (PR.cast[tag] || PR.cast.N) && (PR.cast[tag] || PR.cast.N).instructions) || '';
    const say = found.map((n) => n + ' as ' + PR.names[n]).join('; ');
    return (base + ' Pronounce these names exactly: ' + say + '. Capitals mark the stressed syllable; say the names naturally, not spelled out.').trim().slice(0, 1000);
  };
  window.ttsLoadGuide = async () => { await loadCast(); };
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const exported = () => { try { return new Set(JSON.parse(localStorage.getItem(LS_EXPORTED) || '[]')); } catch { return new Set(); } };
  const saveExported = (set) => localStorage.setItem(LS_EXPORTED, JSON.stringify(Array.from(set)));
  const baseOf = (url) => url.replace(/[^/]*$/, '');
  // the game's root is two folders above dub/<lang>/index.json
  const gameRoot = () => new URL('../../', P.url).href;
  const liveUrl = (id) => gameRoot() + 'audio/' + P.lang + '/' + safeFilename(id) + '.mp3';
  const live = new Map();

  async function isLive(id) {
    if (live.has(id)) return live.get(id);
    let ok = false;
    try { const r = await fetch(liveUrl(id), { method: 'HEAD', cache: 'no-store' }); ok = r.ok; } catch { ok = false; }
    live.set(id, ok);
    return ok;
  }
  async function batchLines(b) {
    if (P.cache.has(b.file)) return P.cache.get(b.file);
    const r = await fetch(baseOf(P.url) + b.file, { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not load ' + b.file + ' (HTTP ' + r.status + ')');
    const lines = await r.json();
    if (!Array.isArray(lines)) throw new Error(b.file + ' is not a list of lines.');
    P.cache.set(b.file, lines);
    return lines;
  }
  async function countDone(b) {
    const lines = await batchLines(b);
    let n = 0;
    for (const l of lines) if ((await dbGet(l.id)) instanceof Blob) n++;
    b.done = n; b.total = lines.length;
    return n;
  }

  // ---------- loading the index ----------
  async function loadIndex() {
    const url = el('indexUrl').value.trim();
    if (!/^https?:\/\//.test(url)) { showToast('Paste the full address of index.json.'); return; }
    localStorage.setItem(LS_URL, url);
    el('projectStatus').textContent = 'Loading…';
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const idx = await r.json();
      if (!idx || !Array.isArray(idx.batches)) throw new Error('This file has no "batches" list.');
      P.index = idx; P.url = url; P.lang = idx.language || 'en'; P.cache.clear(); live.clear();
      const n = await loadGuide(idx); await loadCast();
      el('guideStatus').textContent = n ? 'Pronunciation guide: ' + n + ' names' + (PR.cast ? '' : ' (connect in Settings to combine it with the voice directions)') : 'No pronunciation guide found next to the index.';
      P.batches = idx.batches.map((b) => ({ file: b.file, title: b.title || b.file, lines: b.lines || 0, characters: b.characters || 0, done: 0, total: b.lines || 0 }));
      renderList();
      el('projectStatus').textContent = 'Counting what is already recorded…';
      for (const b of P.batches) { try { await countDone(b); } catch { /* counted later */ } renderRow(b); }
      summarize();
      showToast(P.batches.length + ' batches loaded');
    } catch (e) {
      el('projectStatus').textContent = 'Could not load the index: ' + e.message;
    }
  }

  // ---------- the list ----------
  function renderList() {
    const box = el('projectList');
    box.className = 'line-list';
    box.innerHTML = '';
    P.batches.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'line-item project-row';
      row.dataset.file = b.file;
      row.innerHTML = '<div class="line-top"><span class="line-id project-title"></span><span class="line-voice project-count"></span></div>' +
        '<div class="project-bar"><div></div></div><div class="project-actions"><button class="text-button" data-act="open">Open in batch view</button></div>';
      row.querySelector('.project-title').textContent = b.title;
      row.querySelector('[data-act=open]').addEventListener('click', () => openBatch(b));
      box.appendChild(row);
      renderRow(b);
    });
  }
  function renderRow(b) {
    const row = el('projectList').querySelector('[data-file="' + CSS.escape(b.file) + '"]');
    if (!row) return;
    row.querySelector('.project-count').textContent = (b.done || 0) + ' / ' + (b.total || b.lines);
    row.querySelector('.project-bar div').style.width = (b.total ? Math.round((b.done / b.total) * 100) : 0) + '%';
    row.classList.toggle('project-done', b.total > 0 && b.done >= b.total);
    row.classList.toggle('project-active', P.activeFile === b.file);
  }
  function summarize() {
    const done = P.batches.reduce((n, b) => n + (b.done || 0), 0), total = P.batches.reduce((n, b) => n + (b.total || b.lines || 0), 0);
    const fin = P.batches.filter((b) => b.total && b.done >= b.total).length;
    el('projectStatus').textContent = fin + ' of ' + P.batches.length + ' batches finished · ' + done + ' / ' + total + ' lines recorded on this device';
    el('projectRun').disabled = P.running || !P.batches.length;
    el('projectStop').disabled = !P.running;
    el('projectExport').disabled = P.running || !P.batches.length;
  }
  async function openBatch(b) {
    try {
      const lines = await batchLines(b);
      el('jsonInput').value = JSON.stringify(lines, null, 1);
      window.ttsBatchName = b.file.replace(/\.json$/i, '');
      parseBatch();
      el('batchPanel').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { showToast(e.message); }
  }

  // ---------- generating ----------
  // How long OpenAI asks us to wait, from messages like "Please try again in 28m48s" or "in 20s".
  function retryAfter(text) {
    const m = /try again in\s*(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i.exec(text || '');
    if (!m) return 0;
    return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
  }
  P.pace = 250;
  const clock = (ms) => new Date(Date.now() + ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  async function countdown(ms, why) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (P.stop) throw new Error('Stopped.');
      const left = Math.ceil((until - Date.now()) / 60000);
      el('projectProgress').textContent = why + ' Resuming at about ' + new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' (' + left + ' min). Keep this app open, or tap Run all later.';
      await wait(Math.min(30000, until - Date.now()));
    }
  }
  async function speak(item) {
    for (let attempt = 0; attempt < 8; attempt++) {
      let response;
      const instructions = window.ttsInstructions(item);
      try {
        response = await fetch(settings().base + '/api/speech', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ id: item.id, voice: item.voice, text: item.text }, instructions ? { instructions } : {})) });
      } catch (e) {
        // a sleeping free-tier server can drop the first request while it wakes
        el('projectProgress').textContent = 'Waiting for the server to wake… (' + (attempt + 1) + ')';
        await wait(15000);
        continue;
      }
      if (response.ok) return await response.blob();
      const d = await response.json().catch(() => ({}));
      const msg = String(d.detail || d.error || '');
      if (response.status === 429 || /rate limit/i.test(msg)) {
        const ms = retryAfter(msg) || 61000;
        if (/per day|RPD/i.test(msg)) {
          await countdown(ms + 30000, 'OpenAI’s daily limit is reached' + (/Limit (\d+)/.exec(msg) ? ' (' + /Limit (\d+)/.exec(msg)[1] + ' requests a day)' : '') + '.');
        } else {
          P.pace = Math.min(30000, Math.max(P.pace * 2, 5000));
          await countdown(ms + 2000, 'OpenAI’s per-minute limit; slowing down.');
        }
        continue;
      }
      if (response.status >= 500 && attempt < 5) { await wait(8000); continue; }
      throw new Error(msg || 'HTTP ' + response.status);
    }
    throw new Error('The server did not respond after several tries.');
  }
  async function runAll() {
    if (!P.batches.length || P.running) return;
    if (!(await testConnection(false))) { showToast('Connect to your backend first (Settings).'); return; }
    P.running = true; P.stop = false; summarize();
    const skipLive = el('skipLive').checked;
    try {
      for (const b of P.batches) {
        if (P.stop) break;
        const lines = await batchLines(b);
        await countDone(b);
        if (b.done >= b.total) { renderRow(b); continue; }
        P.activeFile = b.file; renderRow(b);
        for (let i = 0; i < lines.length; i++) {
          if (P.stop) break;
          const item = lines[i];
          if ((await dbGet(item.id)) instanceof Blob) continue;
          if (skipLive && !redo().has(item.id) && (await isLive(item.id))) { continue; }
          el('projectProgress').textContent = b.title + ' · line ' + (i + 1) + ' of ' + lines.length;
          const blob = await speak(item);
          await dbPut(item.id, blob);
          const rd = redo(); if (rd.delete(item.id)) saveRedo(rd);
          b.done++; renderRow(b); summarize();
          await wait(P.pace);
        }
        if (skipLive) { let n = 0; for (const l of lines) if ((await dbGet(l.id)) instanceof Blob || (await isLive(l.id))) n++; b.done = n; }
        P.activeFile = null; renderRow(b);
      }
      el('projectProgress').textContent = P.stop ? 'Stopped. Tap Run all to carry on.' : 'All batches done.';
      if (!P.stop) showToast('Every batch is recorded.');
    } catch (e) {
      el('projectProgress').textContent = e.message === 'Stopped.' ? 'Stopped. Tap Run all to carry on.' : 'Paused: ' + e.message + ' Tap Run all to retry.';
      showToast(e.message);
    } finally {
      P.running = false; P.activeFile = null; summarize();
      P.batches.forEach(renderRow);
    }
  }

  // ---------- exporting ----------
  // One ZIP per batch that has new recordings, named after the batch (e.g. 01-capernaum.zip); a very large batch is
  // split into parts (01-capernaum-part2.zip). Each holds audio/<lang>/<id>.mp3.
  async function exportNew() {
    if (!window.JSZip) { showToast('ZIP library did not load. Check your connection.'); return; }
    const done = exported();
    const work = [];
    for (const b of P.batches) {
      const items = [];
      for (const l of await batchLines(b)) { if (done.has(l.id)) continue; const blob = await dbGet(l.id); if (blob instanceof Blob) items.push([l.id, blob]); }
      if (items.length) work.push([b, items]);
    }
    if (!work.length) { showToast('Nothing new to export.'); return; }
    el('projectExport').disabled = true;
    let files = 0, count = 0;
    for (const [b, items] of work) {
      const stem = b.file.replace(/\.json$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
      let part = 1, zip = new JSZip(), folder = zip.folder('audio/' + P.lang), bytes = 0, ids = [];
      const flush = async (last) => {
        if (!ids.length) return;
        el('projectProgress').textContent = 'Packing ' + stem + (part > 1 || !last ? ' part ' + part : '') + ' (' + ids.length + ' files)…';
        const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        const url = URL.createObjectURL(content), a = document.createElement('a');
        a.href = url; a.download = stem + (part > 1 || !last ? '-part' + part : '') + '.zip';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        ids.forEach((i) => done.add(i)); saveExported(done);
        files++; count += ids.length;
        part++; zip = new JSZip(); folder = zip.folder('audio/' + P.lang); bytes = 0; ids = [];
        await wait(1500);
      };
      for (const [id, blob] of items) {
        if (bytes + blob.size > P.partBytes && ids.length) await flush(false);
        folder.file(safeFilename(id) + '.mp3', blob); bytes += blob.size; ids.push(id);
      }
      await flush(part === 1);
    }
    el('projectProgress').textContent = 'Exported ' + count + ' recordings in ' + files + ' ZIP file' + (files > 1 ? 's' : '') + ', named by batch. Unzip each into the game folder and push.';
    summarize();
  }
  async function redoName() {
    const word = el('redoWord').value.trim();
    if (!word || !P.batches.length) { showToast('Load the index and type a name first.'); return; }
    const rx = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z])', 'i');
    const hits = [];
    for (const b of P.batches) for (const l of await batchLines(b)) if (rx.test(l.text)) hits.push(l.id);
    if (!hits.length) { showToast('No spoken line contains “' + word + '”.'); return; }
    if (!confirm('Re-record ' + hits.length + ' line' + (hits.length > 1 ? 's' : '') + ' containing “' + word + '”? They will be made again on the next run and included in the next export.')) return;
    const rd = redo(), ex = exported();
    for (const id of hits) { await dbDeletePrefix(id); rd.add(id); ex.delete(id); }
    saveRedo(rd); saveExported(ex);
    for (const b of P.batches) { await countDone(b); renderRow(b); }
    summarize();
    showToast(hits.length + ' line' + (hits.length > 1 ? 's' : '') + ' queued to re-record.');
  }
  function resetExported() {
    if (!confirm('Forget which recordings were already exported? The next export will include everything recorded on this device.')) return;
    localStorage.removeItem(LS_EXPORTED); showToast('Export history cleared.');
  }

  // ---------- wiring ----------
  el('indexUrl').value = localStorage.getItem(LS_URL) || '';
  el('skipLive').checked = localStorage.getItem(LS_SKIP) !== 'off';
  el('skipLive').addEventListener('change', () => localStorage.setItem(LS_SKIP, el('skipLive').checked ? 'on' : 'off'));
  el('projectLoad').addEventListener('click', loadIndex);
  el('projectRun').addEventListener('click', runAll);
  el('projectStop').addEventListener('click', () => { P.stop = true; el('projectStop').disabled = true; el('projectProgress').textContent = 'Stopping after this line…'; });
  el('projectExport').addEventListener('click', exportNew);
  el('projectReset').addEventListener('click', resetExported);
  el('redoButton').addEventListener('click', redoName);
  if (el('indexUrl').value) loadIndex();
})();
