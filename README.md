# TTS Studio — GitHub Pages + Render

Mobile-first dialogue-to-MP3 generator. The browser app runs on GitHub Pages; the private OpenAI API key stays on the Render backend.

## What this build includes

- Root `index.html` redirects to `/public/`.
- English is enabled now and writes MP3 files to `audio/en/<line-id>.mp3`.
- Spanish is reserved in the language structure for phase 2 (`audio/es/`).
- JSON dialogue import and validation (`[{ "id", "voice", "text" }]`).
- Voice tags: `N`, `W`, `S`, `M`, `F`.
- Batch MP3 generation and preview.
- Overlay ZIP export for merging into an existing game folder.
- Import the current `manifest.js` before exporting; its contents are preserved and new IDs are appended without duplicate registrations.
- GitHub Pages workflow publishes a root redirect plus the `/public/` app.

## Push to GitHub

Upload the contents of this ZIP to the root of your existing repository, preserving folders. This is a fresh project package; if your existing repository has custom changes, back it up or merge rather than blindly overwriting those files.

GitHub Pages deployment is handled by `.github/workflows/pages.yml`. In repository Settings → Pages, select **GitHub Actions** as the build and deployment source. After the workflow succeeds, the repository root URL redirects to `/public/`.

## Render backend

The Render blueprint is in `render.yaml`. Create/update the web service using the `server` directory as root.

Set these Render environment variables:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key (keep private; never put it in GitHub) |
| `APP_ACCESS_CODE` | A private access code you choose |
| `ALLOWED_ORIGINS` | Exact Pages origin, e.g. `https://YOURNAME.github.io` |
| `TTS_MODEL` | `gpt-4o-mini-tts` |

`ALLOWED_ORIGINS` is the origin only: do not include the repository path or `/public/`. For a GitHub Pages URL such as `https://YOURNAME.github.io/REPOSITORY/public/`, the origin is `https://YOURNAME.github.io`.

The API exposes `/health`, `/api/voices`, and `/api/speech`. `/health` is public; speech and voice endpoints require `x-app-access-code`.

## Use

1. Open the Pages URL; it redirects to `/public/`.
2. Enter your Render service URL and `APP_ACCESS_CODE` in TTS Studio.
3. Tap **Test connection**.
4. Paste or upload a JSON array. Each item requires `id`, `voice`, and `text`.
5. Validate, generate, and preview the audio.
6. Import your existing `manifest.js` in step 5.
7. Export the overlay ZIP.
8. Extract/merge the overlay into the root of your existing game project. It adds `audio/en/` and an updated `manifest.js`.

Example input:

```json
[
  {
    "id": "s-KJV-7c5c72ce",
    "voice": "S",
    "text": "And now when the even was come..."
  }
]
```

Voice tags map to OpenAI voices:
- `N` → ash
- `W` → coral
- `S` → sage
- `M` → onyx
- `F` → nova

The voice instructions are designed as starting profiles and can be refined after listening to sample output.

## Overlay ZIP and manifest behavior

The overlay ZIP contains:

```text
audio/
  en/
    <line-id>.mp3
manifest.js
OVERLAY-README.txt
```

Existing manifest content is retained if you import it before export. The app scans existing `TW.Dubs.add('en', [...])` registrations and appends only newly generated IDs. Keep the updated manifest at the path your game already loads. Back up the project before merging.

## Spanish phase 2

The app is structured around language-specific output paths and registrations. English is the only enabled production language in this build. When Spanish generation is added, it will produce `audio/es/<line-id>.mp3` and `TW.Dubs.add('es', [...])`, without mixing Spanish registrations into English.

## Security notes

- Never put `OPENAI_API_KEY` in frontend files or GitHub.
- `APP_ACCESS_CODE` is a basic shared gate for a personal tool, not full user authentication.
- Do not share your Render secrets in chat or commit them to the repository.


## Interface update

Server URL and access-code fields are collapsed under **Settings** by default. After parsing JSON, the app displays each parsed dialogue line with its ID, voice tag/profile, and text before generation.
