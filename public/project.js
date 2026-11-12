/* TTS Studio — whole-project queue, English and Spanish together.
   Paste the address of either language's index (e.g. https://YOU.github.io/the-way/dub/en/index.json). The queue
   loads every language next to it (dub/en, dub/es), pairs batches by file name, and records them one line at a time.
   Each language has its own voices (voices.json), pronunciation guide (pronounce.json) and, optionally, a Scripture
   batch (scripture.json) saved from the game. Recordings are stored in this browser: English by line id (as before),
   other languages as "<lang>:<id>". Exports are one ZIP per batch, with audio/en/ and audio/es/ inside.
   Uses settings(), headers(), dbGet(), dbPut(), dbDeletePrefix(), safeFilename(), showToast(), testConnection() and
   parseBatch() from app.js. */
(function () {
  const LANGS = ['en', 'es'];
  const NAMES = { en: 'English', es: 'Español' };
  const P = { url: '', root: '', L: {}, rows: [], running: false, stop: false, pace: 250, partBytes: 35 * 1024 * 1024 };
  const LS_URL = 'tts_index_url', LS_EXPORTED = 'tts_exported_ids', LS_SKIP = 'tts_skip_live', LS_REDO = 'tts_redo_ids', LS_LANGS = 'tts_langs';
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const getSet = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } };
  const putSet = (k, s) => localStorage.setItem(k, JSON.stringify(Array.from(s)));
  const keyOf = (lang, id) => (lang === 'en' ? id : lang + ':' + id);
  const useLang = (lang) => { try { const on = JSON.parse(localStorage.getItem(LS_LANGS) || '{}'); return on[lang] !== false; } catch { return true; } };

  // ---------- voices and pronunciation, per language ----------
  let SERVER_CAST = null;
  async function loadServerCast() {
    try { const r = await fetch(settings().base + '/api/voices', { headers: headers() }); if (r.ok) SERVER_CAST = (await r.json()).cast || null; } catch { SERVER_CAST = null; }
  }
  async function getJSON(url) { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } }
  function guideRegex(names) {
    const keys = Object.keys(names || {}).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return keys.length ? new RegExp('\\b(' + keys.join('|') + ')(?![a-z])', 'g') : null;
  }
  const roleOf = (item) => String((item && item.voice) || 'N').toUpperCase();
  const langOf = (item) => String((item && item.lang) || 'en').toLowerCase();
  // Direction for one line: the role's direction, context for this kind of line and its speaker, and any names in it.
  window.ttsInstructions = function (item) {
    if (!item || !item.text) return '';
    const L = P.L[langOf(item)] || P.L.en || {};
    const tag = roleOf(item);
    const g = L.cast && L.cast.cast && (L.cast.cast[tag] || L.cast.cast.N);
    const s = SERVER_CAST && (SERVER_CAST[tag] || SERVER_CAST.N);
    const parts = [];
    const base = (g && g.instructions) || (s && s.instructions) || '';
    if (base) parts.push(base);
    const kind = L.cast && L.cast.kinds && item.kind && L.cast.kinds[item.kind];
    if (kind) parts.push(kind);
    if (item.speaker) parts.push('Speaker: ' + item.speaker + '.');
    const found = L.re ? [...new Set((item.text.match(L.re) || []))] : [];
    if (found.length) parts.push('Pronunciation: say ' + found.map((n) => n + ' as ' + L.names[n]).join('; ') + '. Capitals mark the stressed syllable; say the names naturally, never spelled out.');
    if (!g && !kind && !item.speaker && !found.length) return '';
    return parts.join('\n').slice(0, 3000);
  };
  window.ttsVoiceFor = function (item) {
    const L = P.L[langOf(item)] || P.L.en || {};
    const g = L.cast && L.cast.cast && (L.cast.cast[roleOf(item)] || L.cast.cast.N);
    const mult = Number(localStorage.getItem('tts_speed') || 1) || 1;
    const out = {};
    if (g && g.voice) out.openaiVoice = g.voice;
    const sp = ((g && g.speed) || 1) * mult;
    if (Math.abs(sp - 1) > 0.001) out.speed = Math.round(sp * 100) / 100;
    return out;
  };

  // ---------- loading ----------
  async function lines(lang, file) {
    const L = P.L[lang];
    if (L.cache.has(file)) return L.cache.get(file);
    const r = await fetch(L.base + file, { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not load ' + lang + '/' + file + ' (HTTP ' + r.status + ')');
    const list = (await r.json()).map((it) => Object.assign({}, it, { lang }));
    L.cache.set(file, list);
    return list;
  }
  async function loadIndex() {
    const url = el('indexUrl').value.trim();
    if (!/^https?:\/\//.test(url)) { showToast('Paste the full address of index.json.'); return; }
    localStorage.setItem(LS_URL, url);
    el('projectStatus').textContent = 'Loading…';
    P.url = url; P.L = {}; P.rows = []; live.clear();
    // the game's root is two folders above dub/<lang>/index.json
    P.root = new URL('../../', url).href;
    await loadServerCast();
    const notes = [];
    for (const lang of LANGS) {
      const base = P.root + 'dub/' + lang + '/';
      const idx = await getJSON(base + 'index.json');
      if (!idx || !Array.isArray(idx.batches)) continue;
      const cast = await getJSON(base + (idx.cast || 'voices.json'));
      const guide = await getJSON(base + (idx.pronunciation || 'pronounce.json'));
      const names = guide ? guide.names || guide : {};
      const batches = idx.batches.map((b) => ({ file: b.file, title: b.title || b.file }));
      const scr = await getJSON(base + 'scripture.json');
      if (Array.isArray(scr) && scr.length) batches.push({ file: 'scripture.json', title: lang === 'es' ? 'Escritura (Reina-Valera)' : 'Scripture' });
      P.L[lang] = { base, idx, cast, names, re: guideRegex(names), batches, cache: new Map() };
      notes.push(NAMES[lang] + ': ' + batches.length + ' batches' + (cast ? '' : ', no voices.json') + (Object.keys(names).length ? ', ' + Object.keys(names).length + ' names' : ''));
    }
    if (!Object.keys(P.L).length) { el('projectStatus').textContent = 'No index found at that address.'; return; }
    // pair batches by file name
    const byStem = new Map();
    for (const lang of Object.keys(P.L)) for (const b of P.L[lang].batches) {
      const stem = b.file.replace(/\.json$/i, '');
      const row = byStem.get(stem) || { stem, title: b.title, parts: {} };
      if (lang === 'en' || !row.title) row.title = b.title;
      row.parts[lang] = { file: b.file, done: 0, total: 0 };
      byStem.set(stem, row);
    }
    P.rows = Array.from(byStem.values());
    el('guideStatus').textContent = notes.join(' · ');
    renderList();
    el('projectStatus').textContent = 'Counting what is already recorded…';
    for (const row of P.rows) { await countRow(row); renderRow(row); }
    summarize();
    showToast(P.rows.length + ' batches loaded');
  }
  async function countRow(row) {
    for (const lang of Object.keys(row.parts)) {
      const part = row.parts[lang];
      try {
        const list = await lines(lang, part.file);
        let n = 0; for (const it of list) if ((await dbGet(keyOf(lang, it.id))) instanceof Blob) n++;
        part.done = n; part.total = list.length;
      } catch { /* leave as is */ }
    }
  }

  // ---------- the list ----------
  function renderList() {
    const box = el('projectList');
    box.className = 'line-list'; box.innerHTML = '';
    P.rows.forEach((row) => {
      const r = document.createElement('div');
      r.className = 'line-item project-row'; r.dataset.stem = row.stem;
      r.innerHTML = '<div class="line-top"><span class="line-id project-title"></span></div><div class="project-langs"></div>' +
        '<div class="project-actions"><button class="text-button" data-act="open">Open in batch view</button><button class="text-button" data-act="redo">Re-record batch</button></div>';
      r.querySelector('.project-title').textContent = row.title;
      r.querySelector('[data-act=open]').addEventListener('click', () => openBatch(row));
      r.querySelector('[data-act=redo]').addEventListener('click', () => redoBatch(row));
      box.appendChild(r);
      renderRow(row);
    });
  }
  function renderRow(row) {
    const r = el('projectList').querySelector('[data-stem="' + CSS.escape(row.stem) + '"]');
    if (!r) return;
    const lg = r.querySelector('.project-langs'); lg.innerHTML = '';
    Object.keys(row.parts).forEach((lang) => {
      const p = row.parts[lang];
      const d = document.createElement('div'); d.className = 'project-lang' + (p.total && p.done >= p.total ? ' project-done' : '');
      d.innerHTML = '<span class="line-voice project-count"></span><div class="project-bar"><div></div></div>';
      d.querySelector('.project-count').textContent = lang.toUpperCase() + ' ' + (p.done || 0) + ' / ' + (p.total || '…');
      d.querySelector('.project-bar div').style.width = (p.total ? Math.round((p.done / p.total) * 100) : 0) + '%';
      lg.appendChild(d);
    });
    r.classList.toggle('project-active', P.active === row.stem);
  }
  function summarize() {
    const parts = [];
    for (const lang of Object.keys(P.L)) {
      let d = 0, t = 0; P.rows.forEach((row) => { const p = row.parts[lang]; if (p) { d += p.done || 0; t += p.total || 0; } });
      parts.push(NAMES[lang] + ' ' + d + ' / ' + t);
    }
    el('projectStatus').textContent = P.rows.length + ' batches · ' + parts.join(' · ') + ' lines recorded on this device';
    el('projectRun').disabled = P.running || !P.rows.length;
    el('projectStop').disabled = !P.running;
    el('projectExport').disabled = P.running || !P.rows.length;
  }
  async function openBatch(row) {
    const lang = row.parts.en ? 'en' : Object.keys(row.parts)[0];
    try {
      const list = await lines(lang, row.parts[lang].file);
      window.ttsBatchName = row.stem; window.ttsBatchLang = lang;
      el('jsonInput').value = JSON.stringify(list, null, 1);
      parseBatch();
      el('batchPanel').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { showToast(e.message); }
  }

  // ---------- generating ----------
  const live = new Map();
  async function isLive(lang, id) {
    const k = lang + ':' + id;
    if (live.has(k)) return live.get(k);
    let ok = false;
    try { const r = await fetch(P.root + 'audio/' + lang + '/' + safeFilename(id) + '.mp3', { method: 'HEAD', cache: 'no-store' }); ok = r.ok; } catch { ok = false; }
    live.set(k, ok);
    return ok;
  }
  function retryAfter(text) {
    const m = /try again in\s*(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i.exec(text || '');
    if (!m) return 0;
    return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
  }
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
        response = await fetch(settings().base + '/api/speech', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ id: item.id, voice: item.voice, text: item.text }, window.ttsVoiceFor(item), instructions ? { instructions } : {})) });
      } catch (e) { el('projectProgress').textContent = 'Waiting for the server to wake… (' + (attempt + 1) + ')'; await wait(15000); continue; }
      if (response.ok) return await response.blob();
      const d = await response.json().catch(() => ({}));
      const msg = String(d.detail || d.error || '');
      if (response.status === 429 || /rate limit/i.test(msg)) {
        const ms = retryAfter(msg) || 61000;
        if (/per day|RPD/i.test(msg)) await countdown(ms + 30000, 'OpenAI’s daily limit is reached' + (/Limit (\d+)/.exec(msg) ? ' (' + /Limit (\d+)/.exec(msg)[1] + ' requests a day)' : '') + '.');
        else { P.pace = Math.min(30000, Math.max(P.pace * 2, 5000)); await countdown(ms + 2000, 'OpenAI’s per-minute limit; slowing down.'); }
        continue;
      }
      if (response.status >= 500 && attempt < 5) { await wait(8000); continue; }
      throw new Error(msg || 'HTTP ' + response.status);
    }
    throw new Error('The server did not respond after several tries.');
  }
  async function runAll() {
    if (!P.rows.length || P.running) return;
    if (!(await testConnection(false))) { showToast('Connect to your backend first (Settings).'); return; }
    P.running = true; P.stop = false; summarize();
    const skipLive = el('skipLive').checked;
    try {
      for (const row of P.rows) {
        for (const lang of Object.keys(row.parts)) {
          if (P.stop || !useLang(lang)) continue;
          const part = row.parts[lang];
          const list = await lines(lang, part.file);
          P.active = row.stem; renderRow(row);
          for (let i = 0; i < list.length; i++) {
            if (P.stop) break;
            const item = list[i], key = keyOf(lang, item.id);
            if ((await dbGet(key)) instanceof Blob) continue;
            if (skipLive && !getSet(LS_REDO).has(key) && (await isLive(lang, item.id))) continue;
            el('projectProgress').textContent = row.title + ' · ' + NAMES[lang] + ' · line ' + (i + 1) + ' of ' + list.length;
            const blob = await speak(item);
            await dbPut(key, blob);
            const rd = getSet(LS_REDO); if (rd.delete(key)) putSet(LS_REDO, rd);
            part.done++; renderRow(row); summarize();
            await wait(P.pace);
          }
        }
        P.active = null; renderRow(row);
        if (P.stop) break;
      }
      el('projectProgress').textContent = P.stop ? 'Stopped. Tap Run all to carry on.' : 'All batches done.';
      if (!P.stop) showToast('Every batch is recorded.');
    } catch (e) {
      el('projectProgress').textContent = e.message === 'Stopped.' ? 'Stopped. Tap Run all to carry on.' : 'Paused: ' + e.message + ' Tap Run all to retry.';
      if (e.message !== 'Stopped.') showToast(e.message);
    } finally { P.running = false; P.active = null; summarize(); P.rows.forEach(renderRow); }
  }

  // ---------- exporting: one ZIP per batch, both languages inside ----------
  async function exportNew() {
    if (!window.JSZip) { showToast('ZIP library did not load. Check your connection.'); return; }
    const done = getSet(LS_EXPORTED);
    const work = [];
    for (const row of P.rows) {
      const items = [];
      for (const lang of Object.keys(row.parts)) for (const it of await lines(lang, row.parts[lang].file)) {
        const key = keyOf(lang, it.id); if (done.has(key)) continue;
        const blob = await dbGet(key); if (blob instanceof Blob) items.push([lang, it.id, key, blob]);
      }
      if (items.length) work.push([row, items]);
    }
    if (!work.length) { showToast('Nothing new to export.'); return; }
    el('projectExport').disabled = true;
    let files = 0, count = 0;
    for (const [row, items] of work) {
      const stem = row.stem.replace(/[^a-zA-Z0-9._-]+/g, '-');
      let part = 1, zip = new JSZip(), bytes = 0, keys = [];
      const flush = async (last) => {
        if (!keys.length) return;
        el('projectProgress').textContent = 'Packing ' + stem + (part > 1 || !last ? ' part ' + part : '') + ' (' + keys.length + ' files)…';
        const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        const url = URL.createObjectURL(content), a = document.createElement('a');
        a.href = url; a.download = stem + (part > 1 || !last ? '-part' + part : '') + '.zip';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        keys.forEach((k) => done.add(k)); putSet(LS_EXPORTED, done);
        files++; count += keys.length;
        part++; zip = new JSZip(); bytes = 0; keys = [];
        await wait(1500);
      };
      for (const [lang, id, key, blob] of items) {
        if (bytes + blob.size > P.partBytes && keys.length) await flush(false);
        zip.folder('audio/' + lang).file(safeFilename(id) + '.mp3', blob); bytes += blob.size; keys.push(key);
      }
      await flush(part === 1);
    }
    el('projectProgress').textContent = 'Exported ' + count + ' recordings in ' + files + ' ZIP file' + (files > 1 ? 's' : '') + ', named by batch, with audio/en and audio/es inside. Unzip each into the game folder and push.';
    summarize();
  }

  // ---------- re-recording ----------
  async function forget(keys) {
    const rd = getSet(LS_REDO), ex = getSet(LS_EXPORTED);
    for (const k of keys) { await dbDeletePrefix(k); rd.add(k); ex.delete(k); }
    putSet(LS_REDO, rd); putSet(LS_EXPORTED, ex);
  }
  async function redoBatch(row) {
    const langs = Object.keys(row.parts).filter(useLang);
    if (!confirm('Re-record “' + row.title + '” in ' + langs.map((l) => NAMES[l]).join(' and ') + '? Its recordings on this device are cleared and made again on the next run (even if already published), then included in the next export.')) return;
    const keys = [];
    for (const lang of langs) for (const it of await lines(lang, row.parts[lang].file)) keys.push(keyOf(lang, it.id));
    await forget(keys);
    await countRow(row); renderRow(row); summarize();
    showToast(keys.length + ' lines queued to re-record.');
  }
  async function redoName() {
    const word = el('redoWord').value.trim();
    if (!word || !P.rows.length) { showToast('Load the index and type a name first.'); return; }
    const rx = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z])', 'i');
    const keys = [];
    for (const row of P.rows) for (const lang of Object.keys(row.parts)) for (const it of await lines(lang, row.parts[lang].file)) if (rx.test(it.text)) keys.push(keyOf(lang, it.id));
    if (!keys.length) { showToast('No spoken line contains “' + word + '”.'); return; }
    if (!confirm('Re-record ' + keys.length + ' line' + (keys.length > 1 ? 's' : '') + ' containing “' + word + '”?')) return;
    await forget(keys);
    for (const row of P.rows) { await countRow(row); renderRow(row); }
    summarize();
    showToast(keys.length + ' line' + (keys.length > 1 ? 's' : '') + ' queued to re-record.');
  }
  function resetExported() {
    if (!confirm('Forget which recordings were already exported? The next export will include everything recorded on this device.')) return;
    localStorage.removeItem(LS_EXPORTED); showToast('Export history cleared.');
  }

  // ---------- wiring ----------
  el('indexUrl').value = localStorage.getItem(LS_URL) || '';
  el('skipLive').checked = localStorage.getItem(LS_SKIP) !== 'off';
  el('skipLive').addEventListener('change', () => localStorage.setItem(LS_SKIP, el('skipLive').checked ? 'on' : 'off'));
  el('genSpeed').value = localStorage.getItem('tts_speed') || '1';
  el('genSpeed').addEventListener('change', () => localStorage.setItem('tts_speed', el('genSpeed').value));
  LANGS.forEach((lang) => {
    const cb = el('lang_' + lang); if (!cb) return;
    cb.checked = useLang(lang);
    cb.addEventListener('change', () => { let on = {}; try { on = JSON.parse(localStorage.getItem(LS_LANGS) || '{}'); } catch { /* ignore */ } on[lang] = cb.checked; localStorage.setItem(LS_LANGS, JSON.stringify(on)); });
  });
  el('projectLoad').addEventListener('click', loadIndex);
  el('projectRun').addEventListener('click', runAll);
  el('projectStop').addEventListener('click', () => { P.stop = true; el('projectStop').disabled = true; el('projectProgress').textContent = 'Stopping after this line…'; });
  el('projectExport').addEventListener('click', exportNew);
  el('projectReset').addEventListener('click', resetExported);
  el('redoButton').addEventListener('click', redoName);
  if (el('indexUrl').value) loadIndex();
})();
