// Gera o texto "Seg a sex, 06h-20h; Sab, 10h-18h" a partir da agenda de um rolê recorrente.
const NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const hora = s => { const [H, M] = s.split(':'); return M === '00' ? `${H}h` : `${H}h${M}`; };

function diasTexto(dows) {
  if (dows.length === 7) return 'Todos os dias';
  const ord = dows.map(d => (d === 0 ? 7 : d)).sort((a, b) => a - b); // semana começa na segunda
  const nm = d => NOMES[d === 7 ? 0 : d];
  const runs = []; let ini = ord[0], ant = ord[0];
  for (let i = 1; i <= ord.length; i++) {
    if (ord[i] === ant + 1) { ant = ord[i]; continue; }
    runs.push([ini, ant]); ini = ord[i]; ant = ord[i];
  }
  return runs.map(([a, b]) => (a === b ? nm(a) : b === a + 1 ? `${nm(a)} e ${nm(b)}` : `${nm(a)} a ${nm(b)}`)).join(', ');
}

function quandoRecorrente(agenda) {
  const grupos = new Map();
  for (const e of agenda) {
    const k = `${e.inicio}|${e.fim}`;
    if (!grupos.has(k)) grupos.set(k, new Set());
    grupos.get(k).add(e.dow);
  }
  return [...grupos].map(([k, dias]) => { const [i, f] = k.split('|'); return `${diasTexto([...dias])}, ${hora(i)}–${hora(f)}`; }).join('; ');
}

function quandoUnico(inicio, fim) {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return f.format(new Date(inicio)) + (fim ? ' até ' + new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(fim)) : '');
}

module.exports = { quandoRecorrente, quandoUnico };
