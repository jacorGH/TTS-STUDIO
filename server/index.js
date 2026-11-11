import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";

const app = express();
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const APP_ACCESS_CODE = process.env.APP_ACCESS_CODE;
// The dated snapshot OpenAI's own speech tooling now defaults to; override with TTS_MODEL if needed.
const MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts-2025-12-15";
// Built-in voices. OpenAI recommends cedar and marin for the best quality.
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];

// Default cast. A game can override voice, speed and direction per line (The Way ships dub/en/voices.json).
// Directions follow OpenAI's recommended order: affect, tone, pacing, emotion, delivery.
const CAST = {
  N: { voice: "cedar", speed: 1.0, instructions: "Voice Affect: A young man in first-century Judea telling what he saw with his own eyes; present, engaged, alive to the moment.\nTone: Warm and sincere, with quiet wonder.\nPacing: Natural storytelling; quicken slightly in tense moments and slow down for important ones.\nEmotion: Let the feeling of each moment come through: curiosity, fear, awe, grief, joy. Never flat or monotone.\nDelivery: Vary pitch and emphasis as a good storyteller does; brief pauses before turning points." },
  W: { voice: "marin", speed: 1.0, instructions: "Voice Affect: A young woman in first-century Judea telling what she saw with her own eyes; bright, observant, alive to the moment.\nTone: Warm and sincere, with quiet wonder.\nPacing: Natural storytelling; quicken slightly in tense moments and slow down for important ones.\nEmotion: Let the feeling of each moment come through: curiosity, fear, awe, grief, joy. Never flat or monotone.\nDelivery: Clear, full and well projected; vary pitch and emphasis; brief pauses before turning points." },
  S: { voice: "verse", speed: 0.95, instructions: "Voice Affect: A reader of Scripture before a gathering; resonant and assured.\nTone: Reverent but alive, never sing-song or droning.\nPacing: Measured, unhurried; rest at commas and between sentences.\nEmotion: Let the words carry their own weight: tender where they are tender, urgent where they are urgent.\nDelivery: Clear and well projected; give quoted speech a slightly different color from the narration." },
  M: { voice: "ash", speed: 1.0, instructions: "Voice Affect: A man speaking in the moment, in his own voice.\nTone: Natural and conversational, matching what he says: wry, frightened, angry, kind or joyful.\nPacing: The rhythm of real speech, with small hesitations where they fit.\nEmotion: Genuine and specific; never flat, never overacted.\nDelivery: Full, clear voice." },
  F: { voice: "coral", speed: 1.0, instructions: "Voice Affect: A woman speaking in the moment, in her own voice.\nTone: Natural and conversational, matching what she says: wry, grieving, urgent, kind or joyful.\nPacing: The rhythm of real speech, with small hesitations where they fit.\nEmotion: Genuine and specific; never flat, never overacted.\nDelivery: Full, clear and well projected, never breathy or quiet." }
};

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Allow non-browser clients without an Origin header; browser origins are restricted when configured.
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "1mb" }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

function requireAccess(req, res, next) {
  if (!APP_ACCESS_CODE) {
    return res.status(503).json({ error: "Backend is not configured: APP_ACCESS_CODE is missing." });
  }
  const supplied = req.get("x-app-access-code");
  if (!supplied || supplied !== APP_ACCESS_CODE) {
    return res.status(401).json({ error: "Invalid app access code." });
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "tts-studio", model: MODEL });
});

app.get("/api/voices", limiter, requireAccess, (_req, res) => {
  res.json({
    model: MODEL,
    voices: VOICES,
    cast: Object.fromEntries(Object.entries(CAST).map(([tag, profile]) => [
      tag, { voice: profile.voice, speed: profile.speed, instructions: profile.instructions }
    ]))
  });
});

app.post("/api/speech", limiter, requireAccess, async (req, res) => {
  try {
    const { id, voice, text, instructions: customInstructions, openaiVoice, speed: customSpeed } = req.body || {};
    if (typeof id !== "string" || !id.trim() || id.length > 180) {
      return res.status(400).json({ error: "A valid id (1–180 characters) is required." });
    }
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Text is required." });
    }
    if (text.length > 4096) {
      return res.status(400).json({ error: "Text exceeds the 4,096-character limit." });
    }

    const tag = typeof voice === "string" ? voice.toUpperCase() : "N";
    const profile = CAST[tag] || CAST.N;
    const instructions = typeof customInstructions === "string" && customInstructions.trim()
      ? customInstructions.trim().slice(0, 3000)
      : profile.instructions;
    // a game may choose the OpenAI voice and the speed for a line
    const chosenVoice = typeof openaiVoice === "string" && VOICES.includes(openaiVoice.toLowerCase()) ? openaiVoice.toLowerCase() : profile.voice;
    const n = Number(customSpeed);
    const speed = Number.isFinite(n) && n > 0 ? Math.min(4, Math.max(0.25, n)) : (profile.speed || 1.0);

    if (!OPENAI_API_KEY) {
      return res.status(503).json({ error: "Backend is not configured: OPENAI_API_KEY is missing." });
    }

    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        voice: chosenVoice,
        instructions,
        speed,
        input: text,
        response_format: "mp3"
      })
    });

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 1200);
      return res.status(upstream.status).json({
        error: "OpenAI speech generation failed.",
        detail
      });
    }

    const audio = Buffer.from(await upstream.arrayBuffer());
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.length),
      "Content-Disposition": `attachment; filename="${safeFilename(id)}.mp3"`,
      "Cache-Control": "no-store",
      "X-TTS-Voice": chosenVoice
    });
    return res.send(audio);
  } catch (error) {
    console.error("Speech route error:", error);
    return res.status(500).json({ error: "Unexpected server error while generating audio." });
  }
});

function safeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "recording";
}

app.use((err, _req, res, _next) => {
  if (err.message === "Origin not allowed by CORS") {
    return res.status(403).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

app.listen(PORT, () => {
  console.log(`TTS Studio backend listening on ${PORT}`);
});
