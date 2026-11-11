import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 10000;
const ACCESS_CODE = process.env.APP_ACCESS_CODE || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';
const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean);

app.set('trust proxy', 1);
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-app-access-code']
}));
app.use(express.json({limit:'1mb'}));
app.use(rateLimit({windowMs:60_000,limit:60,standardHeaders:true,legacyHeaders:false}));

app.get('/health', (_req,res)=>res.json({ok:true,service:'TTS Studio API',model:MODEL}));
function auth(req,res,next){
  if(!ACCESS_CODE){return res.status(503).json({error:'APP_ACCESS_CODE is not configured on the server.'});}
  if(req.get('x-app-access-code')!==ACCESS_CODE){return res.status(401).json({error:'Invalid app access code.'});}
  if(!OPENAI_API_KEY){return res.status(503).json({error:'OPENAI_API_KEY is not configured on the server.'});}
  next();
}
app.get('/api/voices',auth,(_req,res)=>res.json({voices:['alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer','verse']}));
app.post('/api/speech',auth,async(req,res)=>{
  const {text,voice='ash',instructions=''}=req.body||{};
  if(typeof text!=='string'||!text.trim()) return res.status(400).json({error:'Text is required.'});
  if(text.length>4000) return res.status(400).json({error:'Text exceeds the 4,000 character limit.'});
  const allowedVoices=new Set(['alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer','verse']);
  if(!allowedVoices.has(voice)) return res.status(400).json({error:'Unsupported voice.'});
  try{
    const response=await fetch('https://api.openai.com/v1/audio/speech',{
      method:'POST',
      headers:{'Authorization':`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:MODEL,voice,input:text,instructions:typeof instructions==='string'?instructions.slice(0,1000):'',response_format:'mp3'})
    });
    if(!response.ok){
      const detail=await response.text();
      return res.status(response.status).json({error:`OpenAI TTS request failed: ${detail.slice(0,700)}`});
    }
    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader('Cache-Control','no-store');
    response.body.pipeTo(WritableStreamFromNode(res)).catch(err=>{console.error(err);if(!res.headersSent)res.status(500).end();});
  }catch(err){console.error(err);res.status(500).json({error:'Speech generation failed.'});}
});
function WritableStreamFromNode(res){
  return new WritableStream({
    write(chunk){return new Promise((resolve,reject)=>res.write(Buffer.from(chunk),err=>err?reject(err):resolve()));},
    close(){res.end();},
    abort(){res.destroy();}
  });
}
app.listen(PORT,()=>console.log(`TTS Studio API listening on ${PORT}`));
