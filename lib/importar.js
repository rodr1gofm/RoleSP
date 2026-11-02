// Importação de CSV pelo painel: valida tudo, e só então grava, em uma transação (tudo ou nada).
// Chaves de identificação (iguais às do banco): lugar = (nome, bairro); rolê = (lugar, título).
const { validarLugar, validarRole } = require('./validar');

const MAX_LINHAS = 300;
const DIAS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const sem = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const hh = s => (s.length === 4 ? '0' + s : s);

function parseCsv(t) {
  t = t.replace(/^\uFEFF/, '');
  const primeira = t.split(/\r?\n/, 1)[0];
  const sep = primeira.split(';').length > primeira.split(',').length ? ';' : ','; // Excel em português salva com ;
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function diasDe(t) {
  if (t === 'todos' || t === 'todososdias') return [0, 1, 2, 3, 4, 5, 6];
  const out = [];
  for (const p of t.split(',')) {
    const r = p.split('-');
    if (r.length === 1 && p in DIAS) out.push(DIAS[p]);
    else if (r.length === 2 && r[0] in DIAS && r[1] in DIAS) { // aceita virada de semana: sex-dom
      let d = DIAS[r[0]]; const f = DIAS[r[1]];
      for (let i = 0; i < 7; i++) { out.push(d); if (d === f) break; d = (d + 1) % 7; }
    } else return null;
  }
  return [...new Set(out)];
}
function parseAgenda(s) {
  const out = [];
  for (const parte of String(s || '').split(';').map(x => x.trim()).filter(Boolean)) {
    const m = sem(parte).match(/^([a-z,\- ]+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    const dias = m && diasDe(m[1].replace(/\s+/g, ''));
    if (!dias) return { erro: `agenda: não entendi "${parte}" (use: seg-sex 10:00-18:00; sab 10:00-14:00)` };
    for (const d of dias) out.push({ dow: d, inicio: hh(m[2]), fim: hh(m[3]) });
  }
  return out.length ? { agenda: out } : { erro: 'agenda vazia' };
}

function prepararImportacao(csv) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { erros: ['CSV vazio ou só com o cabeçalho'], itens: [] };
  const cab = rows[0].map(sem);
  const falta = ['lugar_nome', 'bairro', 'lat', 'lng', 'titulo', 'categoria', 'preco_reais', 'agenda'].filter(c => !cab.includes(c));
  if (falta.length) return { erros: ['Colunas ausentes no cabeçalho: ' + falta.join(', ')], itens: [] };
  if (rows.length - 1 > MAX_LINHAS) return { erros: [`Máximo de ${MAX_LINHAS} linhas por importação (o arquivo tem ${rows.length - 1})`], itens: [] };
  const erros = [], itens = [], vistos = new Set(), coord = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r.some(x => x.trim() !== '')) continue;
    const g = c => { const k = cab.indexOf(c); return k < 0 ? '' : String(r[k] ?? '').trim(); };
    const e = [], num = s => Number(String(s).replace(',', '.'));
    const lg = validarLugar({ nome: g('lugar_nome'), bairro: g('bairro'), endereco: g('endereco'), metro: g('metro'), lat: num(g('lat')), lng: num(g('lng')) });
    e.push(...lg.erros);
    const ps = sem(g('preco_reais')); let preco = 0;
    if (['0', 'gratuito', 'gratis'].includes(ps)) preco = 0;
    else if (/^\d+([.,]\d{1,2})?$/.test(ps)) preco = Math.round(parseFloat(ps.replace(',', '.')) * 100);
    else e.push('preco_reais inválido (número em reais, ex.: 22,50; ou 0 para gratuito)');
    const ag = parseAgenda(g('agenda')); if (ag.erro) e.push(ag.erro);
    let ver = g('verificado_em'); const br = ver.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br) ver = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    const rl = validarRole({ lugar_id: 1, titulo: g('titulo'), descricao: g('descricao'), categoria: g('categoria'), tags: g('tags').split('|'),
      preco_centavos: preco, tipo: 'recorrente', agenda: ag.agenda || [{ dow: 0, inicio: '00:00', fim: '01:00' }], fonte_url: g('fonte_url'), verificado_em: ver || null, status: 'rascunho' });
    e.push(...rl.erros);
    if (!e.length) {
      const kl = sem(lg.v.nome) + '|' + sem(lg.v.bairro), kr = kl + '|' + sem(rl.v.titulo);
      if (vistos.has(kr)) e.push('repetida no arquivo (mesmo lugar e título)'); vistos.add(kr);
      const c0 = coord.get(kl);
      if (c0 && (Math.abs(c0.lat - lg.v.lat) > 0.0005 || Math.abs(c0.lng - lg.v.lng) > 0.0005)) e.push('coordenadas diferentes das de outra linha do mesmo lugar');
      else coord.set(kl, lg.v);
    }
    if (e.length) erros.push(...e.map(x => `Linha ${i + 1}: ${x}`)); else itens.push({ n: i + 1, lugar: lg.v, role: rl.v });
  }
  if (!erros.length && !itens.length) erros.push('Nenhuma linha de dados encontrada');
  return { erros, itens };
}

async function gravarImportacao(pool, itens, { publicar = false, simular = false } = {}) {
  const c = await pool.connect();
  const r = { lugares_novos: 0, lugares_atualizados: 0, roles_novos: 0, roles_atualizados: 0 };
  try {
    await c.query('BEGIN');
    const cache = new Map();
    for (const { lugar: l, role: v } of itens) {
      const k = sem(l.nome) + '|' + sem(l.bairro); let id = cache.get(k);
      if (!id) {
        const f = await c.query('SELECT id FROM lugares WHERE lower(nome)=lower($1) AND lower(bairro)=lower($2)', [l.nome, l.bairro]);
        if (f.rows.length) {
          id = f.rows[0].id; r.lugares_atualizados++;
          await c.query('UPDATE lugares SET endereco=COALESCE($1,endereco), lat=$2, lng=$3, metro=COALESCE($4,metro) WHERE id=$5', [l.endereco, l.lat, l.lng, l.metro, id]);
        } else {
          id = (await c.query('INSERT INTO lugares (nome, endereco, bairro, lat, lng, metro, tags, fonte_url, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id',
            [l.nome, l.endereco, l.bairro, l.lat, l.lng, l.metro, [], null])).rows[0].id; r.lugares_novos++;
        }
        cache.set(k, id);
      }
      const f2 = await c.query('SELECT id FROM roles WHERE lugar_id=$1 AND lower(titulo)=lower($2)', [id, v.titulo]);
      const ag = JSON.stringify(v.agenda);
      if (f2.rows.length) { // reimportar atualiza o conteúdo e NÃO muda o status
        await c.query(`UPDATE roles SET descricao=$1, categoria=$2, tags=$3, preco_centavos=$4, tipo='recorrente', agenda=$5::jsonb, inicio=NULL, fim=NULL, fonte_url=$6, verificado_em=$7 WHERE id=$8`,
          [v.descricao, v.categoria, v.tags, v.preco_centavos, ag, v.fonte_url, v.verificado_em, f2.rows[0].id]); r.roles_atualizados++;
      } else {
        await c.query(`INSERT INTO roles (lugar_id, titulo, descricao, categoria, tags, preco_centavos, tipo, agenda, status, fonte_url, verificado_em, criado_por) VALUES ($1,$2,$3,$4,$5,$6,'recorrente',$7::jsonb,$8,$9,$10,'painel')`,
          [id, v.titulo, v.descricao, v.categoria, v.tags, v.preco_centavos, ag, publicar ? 'publicado' : 'rascunho', v.fonte_url, v.verificado_em]); r.roles_novos++;
      }
    }
    await c.query(simular ? 'ROLLBACK' : 'COMMIT'); // simular roda tudo de verdade e desfaz no fim
    return r;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

module.exports = { prepararImportacao, gravarImportacao, parseAgenda, parseCsv };
