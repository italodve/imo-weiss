import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

// Banco SQLite único: anúncios de imóveis + fichas de clientes (leads).
// Em produção monte um Volume e aponte DATA_DIR para ele, assim os dados
// sobrevivem a novos deploys.
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = process.env.DATA_DIR || path.join(raiz, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'weiss.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS anuncios (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    categoria TEXT NOT NULL DEFAULT 'Apartamento',
    negocio TEXT NOT NULL DEFAULT 'Venda',
    situacao TEXT NOT NULL DEFAULT 'Ativo',
    preco INTEGER,
    bairro TEXT,
    cidade TEXT,
    quartos INTEGER,
    banheiros INTEGER,
    vagas INTEGER,
    area INTEGER,
    foto TEXT,
    detalhes TEXT,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    alterado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS fichas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT NOT NULL,
    campos TEXT NOT NULL,          -- JSON: [{ "campo": "...", "valor": "..." }]
    origem TEXT,
    etapa TEXT NOT NULL DEFAULT 'recebido',
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_anuncios_situacao ON anuncios(situacao);
  CREATE INDEX IF NOT EXISTS idx_fichas_etapa ON fichas(etapa);
`);

// ---- Anúncios (imóveis) ------------------------------------------------------

export const CATEGORIAS = ['Apartamento', 'Casa', 'Cobertura', 'Comercial', 'Terreno'];
export const NEGOCIOS = ['Venda', 'Aluguel'];
export const SITUACOES = ['Ativo', 'Em negociação', 'Vendido', 'Alugado'];
// Situações que saem do site público e do contexto do assistente.
const SITUACOES_ENCERRADAS = ['Vendido', 'Alugado'];

const MAX_TEXTO = 300;
const MAX_DETALHES = 2000;
const MAX_FOTO = 500;

const texto = (valor, max = MAX_TEXTO) =>
  typeof valor === 'string' ? valor.trim().slice(0, max) : '';
const inteiro = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Math.trunc(Number(valor));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const escolha = (valor, opcoes, padrao) => {
  const v = texto(valor);
  return opcoes.includes(v) ? v : padrao;
};

// Normaliza e valida o corpo vindo do painel. Retorna { anuncio } ou { erro }.
export function normalizarAnuncio(body) {
  const titulo = texto(body?.titulo);
  if (!titulo) {
    return { erro: 'titulo é obrigatório' };
  }

  // Foto: URL externa ou arquivo enviado pelo painel (servido em /fotos).
  const foto = texto(body?.foto, MAX_FOTO);
  if (foto && !/^https?:\/\//i.test(foto) && !/^\/fotos\/[\w.-]+$/.test(foto)) {
    return { erro: 'foto deve ser uma URL http(s) ou um arquivo enviado pelo painel' };
  }

  return {
    anuncio: {
      titulo,
      categoria: escolha(body?.categoria, CATEGORIAS, 'Apartamento'),
      negocio: escolha(body?.negocio, NEGOCIOS, 'Venda'),
      situacao: escolha(body?.situacao, SITUACOES, 'Ativo'),
      preco: inteiro(body?.preco),
      bairro: texto(body?.bairro),
      cidade: texto(body?.cidade),
      quartos: inteiro(body?.quartos),
      banheiros: inteiro(body?.banheiros),
      vagas: inteiro(body?.vagas),
      area: inteiro(body?.area),
      foto,
      detalhes: texto(body?.detalhes, MAX_DETALHES),
    },
  };
}

const stmtListaPublica = db.prepare(
  `SELECT id, titulo, categoria, negocio, situacao, preco, bairro, cidade,
          quartos, banheiros, vagas, area, foto, detalhes
     FROM anuncios
    WHERE situacao NOT IN ('Vendido', 'Alugado')
    ORDER BY criado_em DESC`
);
const stmtListaTotal = db.prepare(`SELECT * FROM anuncios ORDER BY criado_em DESC`);
const stmtBuscaAnuncio = db.prepare(`SELECT * FROM anuncios WHERE id = ?`);
const stmtInsereAnuncio = db.prepare(
  `INSERT INTO anuncios (id, titulo, categoria, negocio, situacao, preco, bairro, cidade,
                         quartos, banheiros, vagas, area, foto, detalhes)
   VALUES (@id, @titulo, @categoria, @negocio, @situacao, @preco, @bairro, @cidade,
           @quartos, @banheiros, @vagas, @area, @foto, @detalhes)`
);
const stmtAtualizaAnuncio = db.prepare(
  `UPDATE anuncios
      SET titulo = @titulo, categoria = @categoria, negocio = @negocio, situacao = @situacao,
          preco = @preco, bairro = @bairro, cidade = @cidade, quartos = @quartos,
          banheiros = @banheiros, vagas = @vagas, area = @area, foto = @foto,
          detalhes = @detalhes, alterado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = @id`
);
const stmtRemoveAnuncio = db.prepare(`DELETE FROM anuncios WHERE id = ?`);

export const listarCatalogo = () => stmtListaPublica.all();
export const listarAnuncios = () => stmtListaTotal.all();
export const buscarAnuncio = (id) => stmtBuscaAnuncio.get(id);

export function criarAnuncio(anuncio) {
  const id = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  stmtInsereAnuncio.run({ id, ...anuncio });
  return stmtBuscaAnuncio.get(id);
}

export function atualizarAnuncio(id, anuncio) {
  const alterados = stmtAtualizaAnuncio.run({ id, ...anuncio }).changes;
  return alterados > 0 ? stmtBuscaAnuncio.get(id) : null;
}

export const removerAnuncio = (id) => stmtRemoveAnuncio.run(id).changes > 0;

// ---- Fichas de clientes (leads) ---------------------------------------------

export const ETAPAS_FICHA = ['recebido', 'conversando', 'fechado'];

const stmtListaFichas = db.prepare(`SELECT * FROM fichas ORDER BY criado_em DESC`);
const stmtBuscaFicha = db.prepare(`SELECT * FROM fichas WHERE id = ?`);
// Uma ficha por visitante: se o cliente completar o fluxo de novo, o registro
// é atualizado em vez de duplicado.
const stmtFichaDoVisitante = db.prepare(
  `SELECT id FROM fichas WHERE visitor_id = ? ORDER BY criado_em DESC LIMIT 1`
);
const stmtInsereFicha = db.prepare(
  `INSERT INTO fichas (visitor_id, campos, origem) VALUES (?, ?, ?)`
);
const stmtAtualizaFicha = db.prepare(`UPDATE fichas SET campos = ?, origem = ? WHERE id = ?`);
const stmtEtapaFicha = db.prepare(`UPDATE fichas SET etapa = ? WHERE id = ?`);
const stmtRemoveFicha = db.prepare(`DELETE FROM fichas WHERE id = ?`);

const montarFicha = (linha) => ({
  id: linha.id,
  visitorId: linha.visitor_id,
  campos: JSON.parse(linha.campos),
  origem: linha.origem || '',
  etapa: linha.etapa,
  criadoEm: linha.criado_em,
});

export const listarFichas = () => stmtListaFichas.all().map(montarFicha);

export function salvarFicha(visitorId, campos, origem) {
  const existente = stmtFichaDoVisitante.get(visitorId);
  if (existente) {
    stmtAtualizaFicha.run(JSON.stringify(campos), origem || null, existente.id);
    return montarFicha(stmtBuscaFicha.get(existente.id));
  }

  const { lastInsertRowid } = stmtInsereFicha.run(visitorId, JSON.stringify(campos), origem || null);
  return montarFicha(stmtBuscaFicha.get(lastInsertRowid));
}

export function moverFicha(id, etapa) {
  if (!ETAPAS_FICHA.includes(etapa)) return false;
  return stmtEtapaFicha.run(etapa, id).changes > 0;
}

export const removerFicha = (id) => stmtRemoveFicha.run(id).changes > 0;

export { SITUACOES_ENCERRADAS };
export default db;
