# TTS Studio

A mobile-first, installable web app for turning game dialogue JSON into OpenAI-generated MP3 files.

## Architecture

- **Frontend:** static files in `public/`; host on GitHub Pages.
- **Backend:** Node.js/Express in `server/`; deploy as a Render Web Service.
- **API key:** stored only as a Render environment variable. It is never sent to the browser.
- **Input format:** `[{ "id": "...", "voice": "S", "text": "..." }]`
- **Output:** MP3 files named with each original `id`, plus a ZIP export.

The five default voice profiles preserve the mapping in the supplied `dub-openai.mjs`:
- `N` → ash
- `W` → coral
- `S` → sage
- `M` → onyx
- `F` → nova

The TTS model defaults to `gpt-4o-mini-tts`. You can change the model and voice directions in `server/index.js`.

## 1. Deploy the backend to Render

1. Create a GitHub repository and upload the contents of this project.
2. In Render, create **New → Web Service** and connect the repository.
3. Set **Root Directory** to `server`.
4. Set **Build Command** to `npm install`.
5. Set **Start Command** to `npm start`.
6. Add these environment variables in Render:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key |
| `APP_ACCESS_CODE` | A long private passcode you choose |
| `ALLOWED_ORIGINS` | Your GitHub Pages origin, e.g. `https://YOUR-USER.github.io` |
| `TTS_MODEL` | `gpt-4o-mini-tts` (optional) |

Render assigns a service URL such as `https://your-tts-service.onrender.com`. Copy it.

**Important:** Do not put the OpenAI API key in GitHub Pages, HTML, JavaScript, or this repository. The access code is a basic gate for a personal tool, not a replacement for strong user authentication. Do not share it publicly.

## 2. Deploy the frontend to GitHub Pages

1. In `public/app.js`, find `DEFAULT_API_BASE`.
2. Replace the empty string with your Render URL, for example:
   `https://your-tts-service.onrender.com`
3. Commit and push the project.
4. In GitHub, open **Settings → Pages**.
5. Under **Build and deployment → Source**, choose **GitHub Actions**. The included `.github/workflows/pages.yml` publishes the `public/` folder whenever you push to `main`.
6. Open the Pages URL shown in the workflow deployment on your iPhone.

The app can be added to the iPhone Home Screen using Safari's **Share → Add to Home Screen**.

## 3. First run

1. Open the app.
2. Tap **Settings** and enter:
   - Backend URL: your Render service URL
   - Access code: the `APP_ACCESS_CODE` value configured on Render
3. Tap **Test connection**.
4. Import your JSON file or paste JSON into the editor.
5. Review the parsed lines and voice assignments.
6. Generate audio. The app processes one line at a time and shows progress.
7. Preview individual MP3s and export all generated audio as a ZIP.

## Whole-project queue (dub index)

The **00 / Project** panel generates an entire game's dialogue in one run, from an index file such as The Way's
`dub/en/index.json`:

1. Paste the index address, e.g. `https://YOU.github.io/the-way/dub/en/index.json`, and tap **Load index**. It is
   remembered on this device. Every batch is listed with how many of its lines are already recorded here.
2. Tap **Run all batches**. Lines are generated one at a time, in order. Everything is saved in this browser as it is
   made, so **Stop** (or closing the app) loses nothing: tap **Run all batches** again to carry on.
3. **Skip lines already published on the game site** (on by default) checks the game's `audio/<lang>/` folder first
   and skips any line whose MP3 is already live, so nothing is paid for twice.
4. Tap **Export new recordings** whenever you like. Only recordings made since the last export are packed, in ZIP
   parts of up to about 35 MB, each laid out as `audio/<lang>/<id>.mp3`. Unzip into the game folder and push.
   **Reset exports** forgets the export history so the next export includes everything on this device.

The queue waits and retries when the server is waking up (Render free tier) or rate-limited. Any batch can also be
opened in the single-batch view below with **Open in batch view**.

### English and Spanish together
Paste the address of either language's index (for The Way, `…/dub/en/index.json`). The queue also loads the other
language next to it (`dub/es/`), and lists each batch once with both languages' progress. Untick a language under
**Languages** to leave it out of runs. Each language uses its own `voices.json` and `pronounce.json`.

- **Working on one batch**: every row has **Record** (records just that batch), **Export** (a ZIP of just that
  batch's new recordings, named after it), **Open** (in the batch view) and **Re-record**. Use the search box (e.g.
  “RV1909”) and **Only incomplete** to find it quickly; the list folds away when you don't need it.
- **Batch view**: the line list folds away, and **Only lines not recorded yet** hides finished lines.
- **Re-record** (on every row): clears that batch's recordings on this device, in the ticked languages, and
  makes them again on the next run, even if already published.
- **Make exported files smaller** (on by default, 48 kbps): each recording is re-encoded as mono MP3 at the chosen
  bitrate before it goes into the ZIP (files already at or below it are copied as they are). Choose 56 or 64 kbps for a
  fuller sound. `audio-compress-test.html` lets you listen to the settings first.
- **Exports**: everything new goes into one ZIP named with the date (e.g. `the-way-audio-2026-11-12.zip`), with
  `audio/en/` and `audio/es/` inside. Only an export larger than about 150 MB is split into parts, since iPhone Safari
  may not have the memory to build a bigger ZIP.
- **Scripture in another version**: Scripture batches saved from the game's developer tools are named after their
  language and version (`scripture-es-RV1909.json`, `scripture-en-KJV.json`). Put them in the matching `dub/<lang>/`
  folder; each appears as its own batch, titled with its version.
- Recordings are stored on this device by line id for English (as before) and as `es:<id>` for Spanish.

### Voices, direction and speed (dub/en/voices.json)
OpenAI's speech model has no inline tags; all direction goes in the `instructions` field, written as short labeled
lines in this order: Voice Affect, Tone, Pacing, Emotion, Delivery (plus Pronunciation and Pauses when needed).
If the game ships a `voices.json` next to the index (The Way does, in `dub/en/`), the queue uses it for every line:

- `cast`: for each role (N, W, S, M, F), the OpenAI `voice`, a `speed` (0.25–4.0) and its `instructions`.
- `kinds`: one line of context added for each kind of line (narration, historical note, Scripture, a question).
- Each batch line also carries its `kind` and, for characters, its `speaker`, which are added to the direction.

**Recording speed** in the panel multiplies every role's speed. Players can also change speed at playback in the
game's settings, which needs no re-recording.

The backend must be redeployed once to use these: it now uses `gpt-4o-mini-tts-2025-12-15`, accepts `openaiVoice`
and `speed` per line, and allows up to 3,000 characters of instructions. OpenAI recommends the cedar and marin voices
for the best quality.

### Pronunciation
If a `pronounce.json` sits next to the index (The Way ships one in `dub/en/`), the queue loads it: a list of names and
how to say them, e.g. `"Capernaum": "kuh-PUR-nay-um"`, with the stressed syllable in capitals. For each line, only
the names that line contains are added to its voice's usual direction (from `/api/voices`), so lines without hard
names are sent exactly as before. Edit `pronounce.json` in the game repo to change how any name sounds.

To fix lines that are already recorded, type a name in **Re-record** (e.g. `Capernaum`) and tap the button. Every
recorded line containing it is cleared on this device, made again on the next run (even if the old version is
already published), and included in the next export.

### OpenAI limits
OpenAI limits how many speech requests an account can make per minute and per day; an account without a payment
method has low limits (for example 50 requests a day for `gpt-4o-mini-tts`). When a limit is hit, the queue pauses,
shows when it will resume, and carries on by itself if the app stays open (an iPhone that locks pauses the page; tap
**Run all batches** again later). After a per-minute limit it also slows down. Adding a payment method to the OpenAI
account raises the limits; see platform.openai.com/account/limits.

The index format is `{ "language": "en", "batches": [{ "file": "01-capernaum.json", "title": "…", "lines": 23 }] }`;
each batch file sits next to the index and holds `[{ "id", "voice", "text" }]`.

## JSON format

```json
[
  {
    "id": "s-KJV-7c5c72ce",
    "voice": "S",
    "text": "And now when the even was come..."
  }
]
```

Every item must have a unique `id`, a `voice` tag, and `text`. Unknown voice tags fall back to `N` on the server.

## Notes and safeguards

- Each text entry is limited to 4,096 characters by the backend.
- Batch generation is sequential to avoid flooding the API and to keep progress predictable.
- Existing generated audio is retained in this browser's local IndexedDB so you can resume and export later from the same browser on the same device.
- Clearing Safari website data can remove locally cached recordings. Export ZIPs regularly.
- OpenAI API usage is billed to your OpenAI API account. Review current pricing and model availability before large batches.
- Render free instances may sleep when idle, so the first request after inactivity can take longer.
- The backend includes basic rate limiting and requires the private access code.

## Project layout

```text
tts-studio/
  public/
    index.html
    styles.css
    app.js
    manifest.webmanifest
    icon.svg
    icon-180.png
    icon-192.png
    icon-512.png
  server/
    index.js
    package.json
  sample/
    sample-batch.json
  render.yaml
  README.md
```

## Troubleshooting

- **Connection failed:** check that the Render service is live, the backend URL has no trailing path, and `ALLOWED_ORIGINS` includes your GitHub Pages origin.
- **Unauthorized:** make sure the app access code matches `APP_ACCESS_CODE` exactly.
- **OpenAI error:** confirm the API key is valid, API billing is enabled, and the selected model/voice is available to your account.
- **ZIP export fails:** ensure the device has enough free memory and try smaller batches.
