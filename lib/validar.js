// Validação de entrada. Texto do usuário é dado, nunca instrução: tudo é checado e limitado aqui.
const CATEGORIAS = ['rango','copo','palco','nerdices','suor','arte','tela','ceu_aberto','feira','mao_na_massa','comunidade','fora_do_obvio'];
const STATUS = ['rascunho', 'publicado', 'arquivado'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const tagsDe = v => Array.isArray(v)
  ? [...new Set(v.filter(t => typeof t === 'string').map(t => t.trim().replace(/^#/, '').toLowerCase()).filter(t => t && t.length <= 30))].slice(0, 20)
  : [];

// Link exibido no site: só http(s), para nunca virar javascript: ou similar. Vazio é permitido.
function linkDe(b, erros) {
  const s = typeof b === 'string' ? b.trim() : '';
  if (!s) return null;
  if (s.length > 300) { erros.push('fonte_url longa demais (máximo 300 caracteres)'); return null; }
  let u = null;
  try { u = new URL(s); } catch (_) { /* tratado abaixo */ }
  if (!u || !['http:', 'https:'].includes(u.protocol) || /\s/.test(s)) { erros.push('fonte_url deve ser um link completo, começando com http:// ou https://'); return null; }
  return s;
}

function validarAgenda(a) {
  if (!Array.isArray(a) || !a.length || a.length > 21) return null;
  const out = [];
  for (const e of a) {
    if (!e || !Number.isInteger(e.dow) || e.dow < 0 || e.dow > 6 || !HORA.test(e.inicio) || !HORA.test(e.fim)) return null;
    out.push({ dow: e.dow, inicio: e.inicio, fim: e.fim });
  }
  return out;
}

function validarLugar(b = {}) {
  const erros = [], v = {};
  v.nome = txt(b.nome, 120); if (!v.nome) erros.push('nome obrigatório');
  v.bairro = txt(b.bairro, 80); if (!v.bairro) erros.push('bairro obrigatório');
  v.endereco = txt(b.endereco, 200) || null;
  v.metro = txt(b.metro, 80) || null;
  v.lat = Number(b.lat); v.lng = Number(b.lng);
  if (!(v.lat >= -24.1 && v.lat <= -23.3 && v.lng >= -46.9 && v.lng <= -46.3)) erros.push('lat/lng fora da Grande SP (lat entre -24.1 e -23.3; lng entre -46.9 e -46.3)');
  v.tags = tagsDe(b.tags);
  v.fonte_url = linkDe(b.fonte_url, erros);
  v.ativo = b.ativo === undefined ? true : !!b.ativo;
  return { v, erros };
}

function validarRole(b = {}) {
  const erros = [], v = {};
  v.lugar_id = Number(b.lugar_id); if (!Number.isInteger(v.lugar_id) || v.lugar_id < 1) erros.push('lugar_id inválido');
  v.titulo = txt(b.titulo, 140); if (!v.titulo) erros.push('titulo obrigatório');
  v.descricao = txt(b.descricao, 1000) || null;
  v.categoria = txt(b.categoria, 30); if (!CATEGORIAS.includes(v.categoria)) erros.push('categoria inválida (use: ' + CATEGORIAS.join(', ') + ')');
  v.tags = tagsDe(b.tags);
  v.preco_centavos = b.preco_centavos; if (!Number.isInteger(v.preco_centavos) || v.preco_centavos < 0 || v.preco_centavos > 1000000) erros.push('preco_centavos obrigatório, inteiro >= 0 (0 = gratuito)');
  v.tipo = b.tipo === undefined ? 'recorrente' : b.tipo; if (!['recorrente', 'unico'].includes(v.tipo)) erros.push('tipo deve ser recorrente ou unico');
  v.agenda = null; v.inicio = null; v.fim = null;
  if (v.tipo === 'recorrente') { v.agenda = validarAgenda(b.agenda); if (!v.agenda) erros.push('agenda inválida: lista de {dow 0-6, inicio "HH:MM", fim "HH:MM"}'); }
  else {
    v.inicio = b.inicio && !isNaN(Date.parse(b.inicio)) ? new Date(b.inicio).toISOString() : null; if (!v.inicio) erros.push('inicio obrigatório para evento único (data ISO com fuso)');
    v.fim = b.fim ? (!isNaN(Date.parse(b.fim)) ? new Date(b.fim).toISOString() : (erros.push('fim inválido'), null)) : null;
  }
  v.status = b.status === undefined ? 'rascunho' : b.status; if (!STATUS.includes(v.status)) erros.push('status inválido');
  v.fonte_url = linkDe(b.fonte_url, erros);
  v.verificado_em = b.verificado_em ? (/^\d{4}-\d{2}-\d{2}$/.test(b.verificado_em) ? b.verificado_em : (erros.push('verificado_em deve ser AAAA-MM-DD'), null)) : null;
  return { v, erros };
}

module.exports = { CATEGORIAS, STATUS, validarLugar, validarRole };
