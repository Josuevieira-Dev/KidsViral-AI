require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuid } = require("uuid");
const { query, initDb } = require("./db");
const { createScript, startMiniMaxVideo, pollMiniMaxVideo } = require("./providers");

const app = express();
const port = process.env.PORT || 3000;
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
fs.mkdirSync(uploadDir, { recursive: true });
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_URL ? [process.env.APP_URL, "http://localhost:3000"] : true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "../public")));
app.use("/uploads", express.static(uploadDir));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

const upload = multer({ dest: uploadDir, limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 30) * 1024 * 1024 } });
const sign = user => jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Faça login para continuar." });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: "Sessão inválida ou expirada." }); }
}
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/api/health", (req, res) => res.json({ ok: true, app: "KidsViral AI", time: new Date().toISOString() }));
app.get("/api/config", (req, res) => res.json({
  providers: { openai: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY, minimax: !!process.env.MINIMAX_API_KEY },
  videoProvider: "MiniMax / Hailuo", textProvider: process.env.OPENAI_API_KEY ? "OpenAI" : process.env.GEMINI_API_KEY ? "Gemini" : "not_configured"
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length < 8) return res.status(400).json({ error: "Informe nome, e-mail válido e senha com pelo menos 8 caracteres." });
  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await query("INSERT INTO users(name,email,password_hash) VALUES($1,lower($2),$3) RETURNING id,name,email,role", [name.trim(), email, hash]);
    res.status(201).json({ token: sign(rows[0]), user: rows[0] });
  } catch (e) { if (e.code === "23505") return res.status(409).json({ error: "Este e-mail já está cadastrado." }); throw e; }
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await query("SELECT * FROM users WHERE email=lower($1)", [email || ""]);
  if (!rows[0] || !(await bcrypt.compare(password || "", rows[0].password_hash))) return res.status(401).json({ error: "E-mail ou senha incorretos." });
  const u = rows[0]; res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));
app.get("/api/me", auth, asyncRoute(async (req, res) => {
  const { rows } = await query("SELECT id,name,email,role,created_at FROM users WHERE id=$1", [req.user.id]);
  res.json(rows[0] || null);
}));

app.get("/api/projects", auth, asyncRoute(async (req, res) => {
  const { rows } = await query("SELECT * FROM projects WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]); res.json(rows);
}));
app.post("/api/projects", auth, asyncRoute(async (req, res) => {
  const id = uuid(), { title, format, prompt } = req.body || {};
  const { rows } = await query("INSERT INTO projects(id,user_id,title,format,prompt) VALUES($1,$2,$3,$4,$5) RETURNING *", [id, req.user.id, (title || "Novo projeto").slice(0,120), format || "youtube", prompt || ""]);
  res.status(201).json(rows[0]);
}));
app.get("/api/projects/:id", auth, asyncRoute(async (req, res) => {
  const { rows } = await query("SELECT * FROM projects WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: "Projeto não encontrado." }); res.json(rows[0]);
}));
app.patch("/api/projects/:id", auth, asyncRoute(async (req, res) => {
  const { title, format, prompt, script, status } = req.body || {};
  const { rows } = await query(`UPDATE projects SET title=COALESCE($3,title),format=COALESCE($4,format),prompt=COALESCE($5,prompt),script=COALESCE($6,script),status=COALESCE($7,status),updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *`,
    [req.params.id, req.user.id, title, format, prompt, script ? JSON.stringify(script) : null, status]);
  if (!rows[0]) return res.status(404).json({ error: "Projeto não encontrado." }); res.json(rows[0]);
}));
app.delete("/api/projects/:id", auth, asyncRoute(async (req, res) => {
  await query("DELETE FROM projects WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]); res.json({ ok: true });
}));

app.get("/api/characters", auth, asyncRoute(async (req, res) => {
  const { rows } = await query("SELECT * FROM characters WHERE user_id=$1 ORDER BY created_at DESC", [req.user.id]); res.json(rows);
}));
app.post("/api/characters", auth, asyncRoute(async (req, res) => {
  const { name, description, visualPrompt } = req.body || {};
  if (!name || !description) return res.status(400).json({ error: "Nome e descrição são obrigatórios." });
  const { rows } = await query("INSERT INTO characters(id,user_id,name,description,visual_prompt) VALUES($1,$2,$3,$4,$5) RETURNING *", [uuid(), req.user.id, name, description, visualPrompt || ""]);
  res.status(201).json(rows[0]);
}));
app.delete("/api/characters/:id", auth, asyncRoute(async (req, res) => {
  await query("DELETE FROM characters WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]); res.json({ ok: true });
}));

app.post("/api/generate/script", auth, asyncRoute(async (req, res) => {
  const { topic, ageRange = "3 a 7 anos", duration = 3, style = "animação 3D colorida", language = "português brasileiro", projectId } = req.body || {};
  if (!topic || topic.length > 1000) return res.status(400).json({ error: "Descreva o tema do vídeo (até 1.000 caracteres)." });
  const script = await createScript({ topic, ageRange, duration, style, language });
  if (projectId) {
    const p = await query("UPDATE projects SET script=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING id", [JSON.stringify(script), projectId, req.user.id]);
    if (!p.rows[0]) return res.status(404).json({ error: "Projeto não encontrado." });
  }
  res.json(script);
}));

app.post("/api/generate/video", auth, asyncRoute(async (req, res) => {
  const { prompt, imageUrl, duration = 6, projectId, format = "16:9" } = req.body || {};
  if (!prompt || prompt.length > 2000) return res.status(400).json({ error: "Informe um prompt de até 2.000 caracteres." });
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) return res.status(400).json({ error: "A imagem de referência deve usar uma URL HTTPS pública." });
  const id = uuid();
  await query("INSERT INTO generations(id,user_id,project_id,provider,kind,status,prompt) VALUES($1,$2,$3,'minimax','video','queued',$4)", [id, req.user.id, projectId || null, prompt]);
  res.status(202).json({ id, status: "queued", message: "Solicitação recebida. A geração pode levar alguns minutos." });
  (async () => {
    try {
      await query("UPDATE generations SET status='processing',updated_at=NOW() WHERE id=$1", [id]);
      const taskId = await startMiniMaxVideo({ prompt, imageUrl, duration, aspectRatio: format });
      await query("UPDATE generations SET provider_task_id=$1,metadata=metadata || $2::jsonb,updated_at=NOW() WHERE id=$3", [taskId, JSON.stringify({ requestedFormat: format }), id]);
    } catch (e) { await query("UPDATE generations SET status='failed',error=$1,updated_at=NOW() WHERE id=$2", [e.message, id]); }
  })();
}));
app.get("/api/generations", auth, asyncRoute(async (req, res) => {
  const { rows } = await query("SELECT id,project_id,provider,kind,status,prompt,provider_task_id,result_url,error,metadata,created_at,updated_at FROM generations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [req.user.id]); res.json(rows);
}));
app.get("/api/generations/:id", auth, asyncRoute(async (req, res) => {
  const { rows } = await query("SELECT * FROM generations WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  const g = rows[0]; if (!g) return res.status(404).json({ error: "Geração não encontrada." });
  if (g.status === "processing" && g.provider_task_id) {
    try {
      const state = await pollMiniMaxVideo(g.provider_task_id);
      if (state.status === "completed") await query("UPDATE generations SET status='completed',result_url=$1,updated_at=NOW() WHERE id=$2", [state.resultUrl, g.id]);
      if (state.status === "failed") await query("UPDATE generations SET status='failed',error=$1,updated_at=NOW() WHERE id=$2", [state.error, g.id]);
    } catch (e) { /* erro transitório de consulta não encerra a tarefa */ }
  }
  const updated = await query("SELECT id,status,result_url,error,provider_task_id,created_at,updated_at FROM generations WHERE id=$1", [g.id]);
  res.json(updated.rows[0]);
}));
app.post("/api/upload", auth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Selecione um arquivo." });
  res.status(201).json({ filename: req.file.filename, originalName: req.file.originalname, url: `/uploads/${req.file.filename}`, note: "Armazenamento local temporário. Configure S3 compatível antes de produção." });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Ocorreu um erro interno." : err.message });
});
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));

initDb().then(() => app.listen(port, () => console.log(`KidsViral AI rodando na porta ${port}`)))
  .catch(err => { console.error("Falha ao inicializar banco:", err); process.exit(1); });
