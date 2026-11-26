require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const path = require('path');
const { query, initDb } = require('./db');
const { createScript, startMiniMaxVideo, getMiniMaxVideo } = require('./providers');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('JWT_SECRET é obrigatório em produção.');
  process.exit(1);
}
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_URL ? [process.env.APP_URL] : true }));
app.use(express.json({ limit: '2mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 30) * 1024 * 1024 }
});

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    if (!token) throw new Error('Token ausente');
    req.user = jwt.verify(token, JWT_SECRET || 'dev-only-change-this-secret');
    next();
  } catch {
    res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
  }
}
function cleanUser(row) { return { id: row.id, name: row.name, email: row.email }; }

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'KidsViral AI', databaseConfigured: Boolean(process.env.DATABASE_URL), time: new Date().toISOString() }));

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 8) {
      return res.status(400).json({ error: 'Informe nome, e-mail válido e senha com pelo menos 8 caracteres.' });
    }
    const id = uuid();
    const hash = await bcrypt.hash(password, 12);
    const result = await query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,LOWER($3),$4) RETURNING id,name,email', [id, name.trim(), email.trim(), hash]);
    const user = cleanUser(result.rows[0]);
    const token = jwt.sign(user, JWT_SECRET || 'dev-only-change-this-secret', { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    next(e);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const result = await query('SELECT * FROM users WHERE email=LOWER($1)', [email || '']);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password || '', row.password_hash))) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    const user = cleanUser(row);
    const token = jwt.sign(user, JWT_SECRET || 'dev-only-change-this-secret', { expiresIn: '7d' });
    res.json({ token, user });
  } catch (e) { next(e); }
});

app.get('/api/me', auth, async (req, res, next) => {
  try {
    const r = await query('SELECT id,name,email FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ user: cleanUser(r.rows[0]) });
  } catch (e) { next(e); }
});

app.get('/api/projects', auth, async (req, res, next) => {
  try {
    const r = await query('SELECT id,title,concept,audience,style,script,created_at,updated_at FROM projects WHERE user_id=$1 ORDER BY updated_at DESC', [req.user.id]);
    res.json({ projects: r.rows });
  } catch (e) { next(e); }
});

app.post('/api/projects', auth, async (req, res, next) => {
  try {
    const { title, concept = '', audience = '3-8 anos', style = 'Animação 3D colorida' } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'Informe o nome do projeto.' });
    const r = await query('INSERT INTO projects(id,user_id,title,concept,audience,style) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [uuid(), req.user.id, title.trim(), concept, audience, style]);
    res.status(201).json({ project: r.rows[0] });
  } catch (e) { next(e); }
});

app.delete('/api/projects/:id', auth, async (req, res, next) => {
  try {
    const r = await query('DELETE FROM projects WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Projeto não encontrado.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/projects/:id/script', auth, async (req, res, next) => {
  try {
    const project = await query('SELECT * FROM projects WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!project.rows[0]) return res.status(404).json({ error: 'Projeto não encontrado.' });
    const p = project.rows[0];
    const generated = await createScript({ concept: req.body.concept || p.concept || p.title, audience: p.audience, style: p.style, provider: req.body.provider || 'auto' });
    await query('UPDATE projects SET script=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3', [JSON.stringify(generated.script), p.id, req.user.id]);
    res.json(generated);
  } catch (e) { next(e); }
});

app.get('/api/generations', auth, async (req, res, next) => {
  try {
    const r = await query('SELECT id,project_id,provider,status,task_id,result_url,error,created_at FROM generations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [req.user.id]);
    res.json({ generations: r.rows });
  } catch (e) { next(e); }
});

app.post('/api/projects/:id/video', auth, async (req, res, next) => {
  try {
    const p = await query('SELECT id,script FROM projects WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'Projeto não encontrado.' });
    const prompt = String(req.body.prompt || p.rows[0].script?.scenes?.[0]?.visual_prompt || '').trim();
    if (prompt.length < 8) return res.status(400).json({ error: 'Crie um roteiro ou informe uma descrição visual para a cena.' });
    const task = await startMiniMaxVideo({ prompt, duration: req.body.duration, imageUrl: req.body.imageUrl });
    const id = uuid();
    await query('INSERT INTO generations(id,user_id,project_id,provider,status,task_id,prompt) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, req.user.id, p.rows[0].id, 'minimax', 'processing', task.taskId, prompt]);
    res.status(202).json({ id, taskId: task.taskId, status: 'processing' });
  } catch (e) { next(e); }
});

app.post('/api/generations/:id/refresh', auth, async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM generations WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Geração não encontrada.' });
    const g = r.rows[0];
    if (g.status === 'completed' || g.status === 'failed') return res.json({ status: g.status, resultUrl: g.result_url, error: g.error });
    const state = await getMiniMaxVideo(g.task_id);
    const status = ['success','succeed','completed'].includes(state.status) ? 'completed' : ['failed','fail'].includes(state.status) ? 'failed' : 'processing';
    await query('UPDATE generations SET status=$1,result_url=$2,error=$3,updated_at=NOW() WHERE id=$4', [status, state.resultUrl, status === 'failed' ? 'A MiniMax informou falha na geração.' : null, g.id]);
    res.json({ status, resultUrl: state.resultUrl });
  } catch (e) { next(e); }
});

app.post('/api/upload-check', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  res.json({ name: req.file.originalname, size: req.file.size, note: 'Arquivo recebido em memória. Configure armazenamento de objetos para persistência.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Ocorreu um erro interno. Tente novamente.' : err.message });
});

initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`KidsViral AI disponível na porta ${PORT}`));
}).catch(err => {
  console.error('Falha ao inicializar banco de dados:', err);
  process.exit(1);
});
