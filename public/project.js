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
  const LS_URL = 'tts_index_url', LS_EXPORTED = 'tts_exported_ids', LS_SKIP = 'tts_skip_live';
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
      parseBatch();
      el('batchPanel').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { showToast(e.message); }
  }

  // ---------- generating ----------
  async function speak(item) {
    for (let attempt = 0; attempt < 4; attempt++) {
      let response;
      try {
        response = await fetch(settings().base + '/api/speech', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, voice: item.voice, text: item.text }) });
      } catch (e) {
        // a sleeping free-tier server can drop the first request while it wakes
        el('projectProgress').textContent = 'Waiting for the server to wake… (' + (attempt + 1) + ')';
        await wait(15000);
        continue;
      }
      if (response.status === 429) { el('projectProgress').textContent = 'Rate limited; waiting a minute…'; await wait(61000); continue; }
      if (response.status >= 500 && attempt < 3) { await wait(8000); continue; }
      if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error(d.detail || d.error || 'HTTP ' + response.status); }
      return await response.blob();
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
          if (skipLive && (await isLive(item.id))) { continue; }
          el('projectProgress').textContent = b.title + ' · line ' + (i + 1) + ' of ' + lines.length;
          const blob = await speak(item);
          await dbPut(item.id, blob);
          b.done++; renderRow(b); summarize();
          await wait(250);
        }
        if (skipLive) { let n = 0; for (const l of lines) if ((await dbGet(l.id)) instanceof Blob || (await isLive(l.id))) n++; b.done = n; }
        P.activeFile = null; renderRow(b);
      }
      el('projectProgress').textContent = P.stop ? 'Stopped. Tap Run all to carry on.' : 'All batches done.';
      if (!P.stop) showToast('Every batch is recorded.');
    } catch (e) {
      el('projectProgress').textContent = 'Paused: ' + e.message + ' Tap Run all to retry.';
      showToast(e.message);
    } finally {
      P.running = false; P.activeFile = null; summarize();
      P.batches.forEach(renderRow);
    }
  }

  // ---------- exporting ----------
  async function exportNew() {
    if (!window.JSZip) { showToast('ZIP library did not load. Check your connection.'); return; }
    const done = exported(), stamp = new Date().toISOString().slice(0, 10);
    const pending = [];
    for (const b of P.batches) for (const l of await batchLines(b)) { if (done.has(l.id)) continue; const blob = await dbGet(l.id); if (blob instanceof Blob) pending.push([l.id, blob]); }
    if (!pending.length) { showToast('Nothing new to export.'); return; }
    el('projectExport').disabled = true;
    let part = 1, zip = new JSZip(), folder = zip.folder('audio/' + P.lang), bytes = 0, ids = [];
    const flush = async () => {
      if (!ids.length) return;
      el('projectProgress').textContent = 'Packing part ' + part + ' (' + ids.length + ' files)…';
      const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const url = URL.createObjectURL(content), a = document.createElement('a');
      a.href = url; a.download = 'tts-audio-' + P.lang + '-' + stamp + '-part' + part + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      ids.forEach((i) => done.add(i)); saveExported(done);
      part++; zip = new JSZip(); folder = zip.folder('audio/' + P.lang); bytes = 0; ids = [];
      await wait(1500);
    };
    for (const [id, blob] of pending) {
      if (bytes + blob.size > P.partBytes && ids.length) await flush();
      folder.file(safeFilename(id) + '.mp3', blob); bytes += blob.size; ids.push(id);
    }
    await flush();
    el('projectProgress').textContent = 'Exported ' + pending.length + ' recordings in ' + (part - 1) + ' ZIP file' + (part > 2 ? 's' : '') + '. Unzip each into the game folder and push.';
    summarize();
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
  if (el('indexUrl').value) loadIndex();
})();
