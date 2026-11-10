import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";

const app = express();
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const APP_ACCESS_CODE = process.env.APP_ACCESS_CODE;
const MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";

const CAST = {
  N: {
    voice: "ash",
    instructions: "A thoughtful young man in first-century Judea, telling what he saw. Warm, unhurried, plain. No theatrics."
  },
  W: {
    voice: "coral",
    instructions: "A thoughtful young woman in first-century Judea, telling what she saw. Warm, unhurried, plain. No theatrics."
  },
  S: {
    voice: "sage",
    instructions: "Reverent, clear and measured, as Scripture read aloud to a gathering. Pause gently at commas and between sentences."
  },
  M: {
    voice: "onyx",
    instructions: "A man speaking sincerely in the moment, natural and conversational, never exaggerated."
  },
  F: {
    voice: "nova",
    instructions: "A woman speaking sincerely in the moment, natural and conversational, never exaggerated."
  }
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
    cast: Object.fromEntries(Object.entries(CAST).map(([tag, profile]) => [
      tag, { voice: profile.voice, instructions: profile.instructions }
    ]))
  });
});

app.post("/api/speech", limiter, requireAccess, async (req, res) => {
  try {
    const { id, voice, text, instructions: customInstructions } = req.body || {};
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
      ? customInstructions.trim().slice(0, 1000)
      : profile.instructions;

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
        voice: profile.voice,
        instructions,
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
      "X-TTS-Voice": profile.voice
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
