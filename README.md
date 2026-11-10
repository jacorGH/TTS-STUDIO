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
