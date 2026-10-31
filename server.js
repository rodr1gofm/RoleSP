// API do RoleSP v0. Express + Postgres (Neon). Variáveis de ambiente: veja .env.example
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Pool, types } = require('pg');
types.setTypeParser(20, v => parseInt(v, 10)); // ids bigint chegam como número, não texto
const { CATEGORIAS, validarLugar, validarRole } = require('./lib/validar');
const { quandoRecorrente, quandoUnico } = require('./lib/quando');

const { DATABASE_URL, ADMIN_PASSWORD = '', ALLOWED_ORIGIN = '', PORT = 3000 } = process.env;
if (!DATABASE_URL) { console.error('Defina DATABASE_URL.'); process.exit(1); }
const ADMIN_OK = ADMIN_PASSWORD.length >= 12;
if (!ADMIN_OK) console.warn('AVISO: ADMIN_PASSWORD ausente ou com menos de 12 caracteres. Rotas /api/admin desativadas.');

const pool = new Pool({ connectionString: DATABASE_URL, max: 5, ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: true } });
pool.on('error', e => console.error('erro no pool:', e.message));

const app = express();
app.set('trust proxy', 1); // Render fica atrás de um proxy: necessário para o limite por IP funcionar
app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGIN ? ALLOWED_ORIGIN.split(',').map(s => s.trim()) : false, methods: ['GET', 'POST', 'PUT', 'PATCH'] }));
app.use(express.json({ limit: '20kb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));

/* ---------- utilidades ---------- */
const SQL_BASE = `
  SELECT r.id, r.titulo, r.descricao, r.categoria, r.tags, r.preco_centavos, r.tipo, r.agenda, r.inicio, r.fim,
         r.status, r.fonte_url, r.verificado_em,
         l.id AS lugar_id, l.nome AS lugar_nome, l.endereco, l.bairro, l.lat, l.lng, l.metro, l.tags AS lugar_tags, l.ativo AS lugar_ativo
  FROM roles r JOIN lugares l ON l.id = r.lugar_id`;

const paraApi = (r, admin = false) => ({
  id: r.id, titulo: r.titulo, descricao: r.descricao, categoria: r.categoria, tags: r.tags,
  preco_centavos: r.preco_centavos, gratuito: r.preco_centavos === 0,
  tipo: r.tipo, agenda: r.agenda, inicio: r.inicio, fim: r.fim,
  quando: r.tipo === 'recorrente' ? quandoRecorrente(r.agenda) : quandoUnico(r.inicio, r.fim),
  verificado_em: r.verificado_em,
  lugar: { id: r.lugar_id, nome: r.lugar_nome, endereco: r.endereco, bairro: r.bairro, lat: Number(r.lat), lng: Number(r.lng), metro: r.metro, tags: r.lugar_tags },
  ...(admin ? { status: r.status, fonte_url: r.fonte_url, lugar_ativo: r.lugar_ativo } : {}),
});

const DIAS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const PERIODOS = { madrugada: [0, 300], manha: [300, 720], tarde: [720, 1080], noite: [1080, 1440] };
function dowSP(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  const nome = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(d).toLowerCase().slice(0, 3);
  return { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[nome];
}
const min = s => +s.slice(0, 2) * 60 + +s.slice(3);
// Um horário bate com o período se os intervalos se sobrepõem (considera virada de meia-noite).
function bateAgenda(agenda, dow, periodo) {
  return agenda.some(e => {
    if (dow != null && e.dow !== dow) return false;
    if (!periodo) return true;
    const i = min(e.inicio); let f = min(e.fim); if (f <= i) f += 1440;
    const [pa, pb] = PERIODOS[periodo];
    return [0, 1440].some(sh => i < pb + sh && f > pa + sh);
  });
}
const lista = v => (typeof v === 'string' && v ? v.split(',').map(s => s.trim()).filter(Boolean).slice(0, 12) : []);
const bad = (res, erro) => res.status(400).json({ erro });
const idDe = req => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

/* ---------- rotas públicas ---------- */
app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1'); // também acorda o banco (Neon) e confirma que a API está viva
  res.json({ ok: true });
}));

app.get('/api/meta', wrap(async (req, res) => {
  const q = await pool.query(`SELECT DISTINCT l.bairro FROM roles r JOIN lugares l ON l.id=r.lugar_id
    WHERE r.status='publicado' AND l.ativo ORDER BY 1`);
  const t = await pool.query(`SELECT DISTINCT unnest(r.tags) AS tag FROM roles r JOIN lugares l ON l.id=r.lugar_id
    WHERE r.status='publicado' AND l.ativo ORDER BY 1`);
  res.json({ categorias: CATEGORIAS, bairros: q.rows.map(r => r.bairro), tags: t.rows.map(r => r.tag) });
}));

// Filtros: categoria=a,b (qualquer uma) | tag=x,y (todas) | preco_max=30 (reais) | gratuito=1 | bairro=Luz
//          dia=hoje|amanha|dom..sab | periodo=madrugada|manha|tarde|noite | q=texto | limit
app.get('/api/roles', wrap(async (req, res) => {
  const { categoria, tag, preco_max, gratuito, bairro, dia, periodo, q } = req.query;
  const where = [`r.status = 'publicado'`, 'l.ativo',
    `(r.tipo = 'recorrente' OR COALESCE(r.fim, r.inicio + interval '6 hours') >= now())`]; // únicos expiram sozinhos
  const p = [];
  const add = (sql, val) => { p.push(val); where.push(sql.replace('?', '$' + p.length)); };

  const cats = lista(categoria);
  if (cats.some(c => !CATEGORIAS.includes(c))) return bad(res, 'categoria inválida');
  if (cats.length) add('r.categoria = ANY(?)', cats);
  const tags = lista(tag).map(t => t.replace(/^#/, '').toLowerCase());
  if (tags.length) add('r.tags @> ?', tags);
  if (gratuito === '1' || gratuito === 'true') where.push('r.preco_centavos = 0');
  else if (preco_max !== undefined) {
    const n = Number(String(preco_max).replace(',', '.'));
    if (!(n >= 0 && n <= 10000)) return bad(res, 'preco_max inválido (em reais)');
    add('r.preco_centavos <= ?', Math.round(n * 100));
  }
  if (bairro) add('lower(l.bairro) = lower(?)', String(bairro).slice(0, 80));
  if (q) {
    p.push(String(q).slice(0, 80).replace(/[%_\\]/g, m => '\\' + m)); const n = p.length;
    where.push(`(r.titulo ILIKE '%'||$${n}||'%' OR l.nome ILIKE '%'||$${n}||'%' OR r.descricao ILIKE '%'||$${n}||'%')`);
  }

  let dow = null;
  if (dia) {
    if (dia === 'hoje') dow = dowSP(0); else if (dia === 'amanha') dow = dowSP(1); else if (dia in DIAS) dow = DIAS[dia];
    else return bad(res, 'dia inválido (hoje, amanha, dom, seg, ter, qua, qui, sex, sab)');
  }
  if (periodo && !(periodo in PERIODOS)) return bad(res, 'periodo inválido (madrugada, manha, tarde, noite)');

  const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 500);
  const { rows } = await pool.query(`${SQL_BASE} WHERE ${where.join(' AND ')} ORDER BY r.preco_centavos, r.titulo LIMIT 1000`, p);
  // dia e período são filtrados aqui porque dependem da agenda (JSON) e do fuso de São Paulo. Com 60 a 100 rolês isso é instantâneo.
  const out = rows.filter(r => {
    if (dow == null && !periodo) return true;
    if (r.tipo === 'recorrente') return bateAgenda(r.agenda, dow, periodo);
    const d = new Date(r.inicio);
    const nome = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(d).toLowerCase().slice(0, 3);
    const dd = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[nome];
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d);
    return bateAgenda([{ dow: dd, inicio: hm, fim: hm === '23:59' ? '23:59' : String(Math.min(23, +hm.slice(0, 2) + 2)).padStart(2, '0') + hm.slice(2) }], dow, periodo);
  }).slice(0, limit).map(r => paraApi(r));
  res.json({ total: out.length, roles: out });
}));

app.get('/api/roles/:id', wrap(async (req, res) => {
  const id = idDe(req); if (!id) return bad(res, 'id inválido');
  const { rows } = await pool.query(`${SQL_BASE} WHERE r.id = $1 AND r.status = 'publicado' AND l.ativo`, [id]);
  if (!rows.length) return res.status(404).json({ erro: 'rolê não encontrado' });
  res.json(paraApi(rows[0]));
}));

/* ---------- rotas de administração (curadoria) ---------- */
const sha = s => crypto.createHash('sha256').update(s).digest();
const adminAuth = (req, res, next) => {
  if (!ADMIN_OK) return res.status(503).json({ erro: 'painel desativado: defina ADMIN_PASSWORD com 12+ caracteres' });
  const h = req.get('authorization') || '';
  const senha = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!crypto.timingSafeEqual(sha(senha), sha(ADMIN_PASSWORD))) return res.status(401).json({ erro: 'senha incorreta' });
  next();
};
// Conta só senhas erradas (resposta 401): 10 por IP a cada 15 min. Erros de validação (400/409) não contam.
app.use('/api/admin', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, requestWasSuccessful: (req, res) => res.statusCode !== 401, standardHeaders: true, legacyHeaders: false, message: { erro: 'muitas tentativas, espere 15 minutos' } }), adminAuth);

app.get('/api/admin/roles', wrap(async (req, res) => {
  const { rows } = await pool.query(`${SQL_BASE} ORDER BY r.atualizado_em DESC LIMIT 1000`);
  res.json({ total: rows.length, roles: rows.map(r => paraApi(r, true)) });
}));
app.get('/api/admin/lugares', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM lugares ORDER BY nome LIMIT 1000');
  res.json({ total: rows.length, lugares: rows.map(l => ({ ...l, lat: Number(l.lat), lng: Number(l.lng) })) });
}));

app.post('/api/admin/lugares', wrap(async (req, res) => {
  const { v, erros } = validarLugar(req.body); if (erros.length) return res.status(400).json({ erros });
  const { rows } = await pool.query(
    `INSERT INTO lugares (nome, endereco, bairro, lat, lng, metro, tags, fonte_url, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [v.nome, v.endereco, v.bairro, v.lat, v.lng, v.metro, v.tags, v.fonte_url, v.ativo]);
  res.status(201).json(rows[0]);
}));
app.put('/api/admin/lugares/:id', wrap(async (req, res) => {
  const id = idDe(req); if (!id) return bad(res, 'id inválido');
  const { v, erros } = validarLugar(req.body); if (erros.length) return res.status(400).json({ erros });
  const { rows } = await pool.query(
    `UPDATE lugares SET nome=$1, endereco=$2, bairro=$3, lat=$4, lng=$5, metro=$6, tags=$7, fonte_url=$8, ativo=$9 WHERE id=$10 RETURNING *`,
    [v.nome, v.endereco, v.bairro, v.lat, v.lng, v.metro, v.tags, v.fonte_url, v.ativo, id]);
  rows.length ? res.json(rows[0]) : res.status(404).json({ erro: 'lugar não encontrado' });
}));

const COLS = 'lugar_id, titulo, descricao, categoria, tags, preco_centavos, tipo, agenda, inicio, fim, status, fonte_url, verificado_em';
const vals = v => [v.lugar_id, v.titulo, v.descricao, v.categoria, v.tags, v.preco_centavos, v.tipo, v.agenda && JSON.stringify(v.agenda), v.inicio, v.fim, v.status, v.fonte_url, v.verificado_em];
app.post('/api/admin/roles', wrap(async (req, res) => {
  const { v, erros } = validarRole(req.body); if (erros.length) return res.status(400).json({ erros });
  const { rows } = await pool.query(
    `INSERT INTO roles (${COLS}, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,'painel') RETURNING id`, vals(v));
  res.status(201).json({ id: rows[0].id });
}));
app.put('/api/admin/roles/:id', wrap(async (req, res) => {
  const id = idDe(req); if (!id) return bad(res, 'id inválido');
  const { v, erros } = validarRole(req.body); if (erros.length) return res.status(400).json({ erros });
  const { rowCount } = await pool.query(
    `UPDATE roles SET lugar_id=$1, titulo=$2, descricao=$3, categoria=$4, tags=$5, preco_centavos=$6, tipo=$7, agenda=$8::jsonb, inicio=$9, fim=$10, status=$11, fonte_url=$12, verificado_em=$13 WHERE id=$14`,
    [...vals(v), id]);
  rowCount ? res.json({ id }) : res.status(404).json({ erro: 'rolê não encontrado' });
}));
app.patch('/api/admin/roles/:id/status', wrap(async (req, res) => {
  const id = idDe(req); if (!id) return bad(res, 'id inválido');
  const s = req.body && req.body.status;
  if (!['rascunho', 'publicado', 'arquivado'].includes(s)) return bad(res, 'status inválido');
  const { rowCount } = await pool.query('UPDATE roles SET status=$1 WHERE id=$2', [s, id]);
  rowCount ? res.json({ id, status: s }) : res.status(404).json({ erro: 'rolê não encontrado' });
}));

/* ---------- erros ---------- */
app.use('/api', (req, res) => res.status(404).json({ erro: 'rota não encontrada' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'corpo grande demais' });
  const map = { '23505': [409, 'já existe um registro igual'], '23503': [400, 'lugar_id não existe'], '23514': [400, 'dados violam uma regra do banco'] };
  if (map[err.code]) return res.status(map[err.code][0]).json({ erro: map[err.code][1] });
  console.error(err); // detalhes só no log do servidor, nunca na resposta
  res.status(500).json({ erro: 'erro interno' });
});

app.listen(PORT, () => console.log('RoleSP API na porta ' + PORT));
