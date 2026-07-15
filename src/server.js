import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { validarMensagem, validarVisitorId } from './validar.js';
import { MemoriaConversas } from './conversas.js';
import { conversar } from './agente.js';
import {
  ETAPAS_FICHA,
  atualizarAnuncio,
  buscarAnuncio,
  criarAnuncio,
  dataDir,
  listarAnuncios,
  listarCatalogo,
  listarFichas,
  moverFicha,
  normalizarAnuncio,
  removerAnuncio,
  removerFicha,
  salvarFicha,
} from './db.js';

const app = express();
const PORT = process.env.PORT || 3000;
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(raiz, 'public');
const viewsDir = path.join(raiz, 'views');
const memoria = new MemoriaConversas();

const segredo = process.env.CONVERSA_SECRET || crypto.randomBytes(32).toString('hex');
const origensExtras = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const TOKEN_CONVERSA_TTL_MS = 15 * 60 * 1000;
const INTERVALO_MINIMO_MSG_MS = 1500;
const MAX_VISITANTES_ATIVOS = 1000;
const ultimaAtividade = new Map();

const adminUser = (process.env.ADMIN_USER || 'martins').trim();
const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_SESSAO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_COOKIE = 'martins_admin';

const MAX_CAMPOS_FICHA = 20;
const MAX_TAMANHO_CAMPO = 200;

// Fotos enviadas pelo painel ficam ao lado do banco (no Volume, em produção)
// e são servidas em /fotos por este mesmo servidor.
const fotosDir = path.join(dataDir, 'fotos');
fs.mkdirSync(fotosDir, { recursive: true });
const TIPOS_FOTO = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_FOTO_BYTES = 5 * 1024 * 1024;

// Remove do disco a foto de um anúncio quando ela veio do painel (/fotos/...)
// e deixou de ser usada (anúncio excluído ou foto substituída).
function apagarFotoEnviada(foto) {
  if (typeof foto !== 'string' || !foto.startsWith('/fotos/')) {
    return;
  }

  fs.unlink(path.join(fotosDir, path.basename(foto)), () => {});
}

// ---- CORS -------------------------------------------------------------------
// O site e o painel são servidos por este mesmo servidor, então o normal é
// tráfego same-origin (que dispensa CORS). Headers CORS só são emitidos para
// origens confiáveis: as que batem com algum host da própria requisição, mais
// a allowlist opcional ALLOWED_ORIGIN. A comparação usa o HOST porque, atrás
// do proxy da hospedagem, protocolo e Host podem divergir do Origin enviado
// pelo browser. Nenhuma requisição é bloqueada por aqui — origem estranha só
// fica sem os headers (browsers de terceiros não conseguem ler a resposta).
// A proteção real do chat é o token assinado; a do painel, o login + cookie.
function hostsDaRequisicao(req) {
  const hosts = new Set();
  const add = (valor) => {
    if (valor) {
      hosts.add(String(valor).trim().toLowerCase());
    }
  };

  add(req.get('host'));
  add(req.hostname); // respeita X-Forwarded-Host com trust proxy ativo
  const encaminhado = req.get('x-forwarded-host');
  if (encaminhado) {
    for (const parte of encaminhado.split(',')) {
      add(parte);
    }
  }

  hosts.delete('');
  return hosts;
}

function origemConfiavel(req, origem) {
  if (!origem) {
    return false;
  }

  let hostDaOrigem;
  try {
    hostDaOrigem = new URL(origem).host.toLowerCase();
  } catch {
    return false;
  }

  // Compara também sem a porta (um lado pode trazer :443/:80 e o outro não).
  const hostnameDaOrigem = hostDaOrigem.split(':')[0];
  for (const host of hostsDaRequisicao(req)) {
    if (host === hostDaOrigem || host.split(':')[0] === hostnameDaOrigem) {
      return true;
    }
  }

  return origensExtras.includes(origem);
}

const corsDelegate = (req, callback) => {
  const origem = req.get('origin');
  if (origem && origemConfiavel(req, origem)) {
    return callback(null, {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-Conversa-Token'],
      maxAge: 600,
    });
  }

  return callback(null, { origin: false });
};

// ---- Tokens de conversa (HMAC) ----------------------------------------------

function assinarTokenConversa(visitorId) {
  const payload = JSON.stringify({
    visitorId,
    exp: Date.now() + TOKEN_CONVERSA_TTL_MS,
  });
  const corpo = Buffer.from(payload).toString('base64url');
  const assinatura = crypto.createHmac('sha256', segredo).update(corpo).digest('base64url');

  return `${corpo}.${assinatura}`;
}

function verificarTokenConversa(token, visitorId) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return false;
  }

  const [corpo, assinaturaRecebida] = token.split('.');
  const assinaturaEsperada = crypto.createHmac('sha256', segredo).update(corpo).digest('base64url');

  const recebida = Buffer.from(assinaturaRecebida);
  const esperada = Buffer.from(assinaturaEsperada);
  if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    return payload.visitorId === visitorId && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

// ---- Sessão do painel (cookie HttpOnly assinado) -----------------------------

function comparacaoSegura(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function assinarSessaoAdmin() {
  const payload = JSON.stringify({ scope: 'admin', exp: Date.now() + ADMIN_SESSAO_TTL_MS });
  const corpo = Buffer.from(payload).toString('base64url');
  const assinatura = crypto
    .createHmac('sha256', segredo)
    .update(`admin.${corpo}`)
    .digest('base64url');

  return `${corpo}.${assinatura}`;
}

function verificarSessaoAdmin(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return false;
  }

  const [corpo, assinaturaRecebida] = token.split('.');
  const assinaturaEsperada = crypto
    .createHmac('sha256', segredo)
    .update(`admin.${corpo}`)
    .digest('base64url');

  const recebida = Buffer.from(assinaturaRecebida);
  const esperada = Buffer.from(assinaturaEsperada);
  if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    return payload.scope === 'admin' && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function lerCookie(req, nome) {
  const header = req.get('cookie');
  if (!header) {
    return '';
  }

  for (const parte of header.split(';')) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave === nome) {
      return decodeURIComponent(resto.join('='));
    }
  }

  return '';
}

function cookieAdmin(req, valor, maxAgeMs) {
  const atributos = [
    `${ADMIN_COOKIE}=${valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (req.secure) {
    atributos.push('Secure');
  }
  return atributos.join('; ');
}

const adminAutenticado = (req) => verificarSessaoAdmin(lerCookie(req, ADMIN_COOKIE));

// ---- Utilidades das fichas ---------------------------------------------------

function limparCamposFicha(brutos) {
  if (!Array.isArray(brutos)) {
    return null;
  }

  const campos = [];
  for (const item of brutos.slice(0, MAX_CAMPOS_FICHA)) {
    if (!item || typeof item.campo !== 'string' || typeof item.valor !== 'string') {
      continue;
    }

    const campo = item.campo.trim().slice(0, MAX_TAMANHO_CAMPO);
    const valor = item.valor.trim().slice(0, MAX_TAMANHO_CAMPO);
    if (campo && valor) {
      campos.push({ campo, valor });
    }
  }

  return campos.length > 0 ? campos : null;
}

function respeitouIntervalo(visitorId) {
  const agora = Date.now();
  const anterior = ultimaAtividade.get(visitorId) || 0;
  if (agora - anterior < INTERVALO_MINIMO_MSG_MS) {
    return false;
  }

  ultimaAtividade.delete(visitorId);
  ultimaAtividade.set(visitorId, agora);

  while (ultimaAtividade.size > MAX_VISITANTES_ATIVOS) {
    const maisAntigo = ultimaAtividade.keys().next().value;
    if (!maisAntigo) {
      break;
    }
    ultimaAtividade.delete(maisAntigo);
  }

  return true;
}

// ---- Middlewares globais -----------------------------------------------------

app.set('trust proxy', 1);
app.use(cors(corsDelegate));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// ---- Login do painel (antes do static, que serve /admin) ---------------------

const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login, tente novamente mais tarde' },
});

app.get('/admin/entrar', (req, res) => {
  if (adminAutenticado(req)) {
    return res.redirect('/admin/');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(viewsDir, 'entrar.html'));
});

app.post(
  '/admin/entrar',
  limiterLogin,
  express.urlencoded({ extended: false, limit: '2kb' }),
  (req, res) => {
    if (!adminPassword) {
      return res
        .status(503)
        .send('Painel não configurado: defina ADMIN_PASSWORD nas variáveis de ambiente.');
    }

    const usuario = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    const usuarioOk = comparacaoSegura(usuario, adminUser);
    const senhaOk = comparacaoSegura(senha, adminPassword);

    if (!usuarioOk || !senhaOk) {
      return res.redirect('/admin/entrar?erro=1');
    }

    res.setHeader('Set-Cookie', cookieAdmin(req, assinarSessaoAdmin(), ADMIN_SESSAO_TTL_MS));
    return res.redirect('/admin/');
  }
);

app.get('/admin/sair', (req, res) => {
  res.setHeader('Set-Cookie', cookieAdmin(req, '', 0));
  return res.redirect('/admin/entrar');
});

// Tudo o mais sob /admin exige sessão válida: API responde 401 em JSON
// (o front-end trata e redireciona), páginas vão direto para o login.
app.use('/admin', (req, res, next) => {
  if (adminAutenticado(req)) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  return res.redirect('/admin/entrar');
});

// ---- API do painel (protegida pelo middleware acima) -------------------------

const adminApi = express.Router();
adminApi.use(express.json({ limit: '32kb' }));

adminApi.get('/anuncios', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(listarAnuncios());
});

adminApi.post('/anuncios', (req, res) => {
  const { anuncio, erro } = normalizarAnuncio(req.body);
  if (erro) {
    return res.status(400).json({ error: erro });
  }
  return res.status(201).json(criarAnuncio(anuncio));
});

adminApi.put('/anuncios/:id', (req, res) => {
  const { anuncio, erro } = normalizarAnuncio(req.body);
  if (erro) {
    return res.status(400).json({ error: erro });
  }

  const anterior = buscarAnuncio(String(req.params.id));
  const atualizado = atualizarAnuncio(String(req.params.id), anuncio);
  if (!atualizado) {
    return res.status(404).json({ error: 'Anúncio não encontrado' });
  }

  if (anterior && anterior.foto !== atualizado.foto) {
    apagarFotoEnviada(anterior.foto);
  }
  return res.json(atualizado);
});

adminApi.delete('/anuncios/:id', (req, res) => {
  const anterior = buscarAnuncio(String(req.params.id));
  if (!removerAnuncio(String(req.params.id))) {
    return res.status(404).json({ error: 'Anúncio não encontrado' });
  }

  apagarFotoEnviada(anterior?.foto);
  return res.status(204).end();
});

// Upload da foto: o painel envia o arquivo direto no corpo da requisição
// (Content-Type da imagem), sem multipart. A resposta traz o caminho público
// que vai no campo "foto" do anúncio.
adminApi.post(
  '/foto',
  express.raw({ type: Object.keys(TIPOS_FOTO), limit: MAX_FOTO_BYTES }),
  (req, res) => {
    const ext = TIPOS_FOTO[(req.get('content-type') || '').split(';')[0].trim().toLowerCase()];
    if (!ext) {
      return res
        .status(415)
        .json({ error: 'Formato não suportado. Envie JPG, PNG, WebP ou GIF.' });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Arquivo vazio' });
    }

    const nome = `foto-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    try {
      fs.writeFileSync(path.join(fotosDir, nome), req.body);
    } catch (err) {
      console.error('Erro no upload:', err.message);
      return res.status(500).json({ error: 'Falha ao salvar o arquivo' });
    }

    return res.status(201).json({ url: `/fotos/${nome}` });
  }
);

adminApi.get('/fichas', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(listarFichas());
});

adminApi.patch('/fichas/:id', (req, res) => {
  const etapa = typeof req.body?.etapa === 'string' ? req.body.etapa : '';
  if (!ETAPAS_FICHA.includes(etapa)) {
    return res.status(400).json({ error: `etapa deve ser uma de: ${ETAPAS_FICHA.join(', ')}` });
  }

  if (!moverFicha(Number(req.params.id), etapa)) {
    return res.status(404).json({ error: 'Ficha não encontrada' });
  }
  return res.json({ status: 'ok' });
});

adminApi.delete('/fichas/:id', (req, res) => {
  if (!removerFicha(Number(req.params.id))) {
    return res.status(404).json({ error: 'Ficha não encontrada' });
  }
  return res.status(204).end();
});

app.use('/admin/api', adminApi);

// ---- API pública do catálogo (alimenta a vitrine do site) --------------------

const limiterCatalogo = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições, tente novamente em instantes' },
});

app.get('/api/catalogo', limiterCatalogo, (_req, res) => {
  // Cache curto: o site reflete alterações do painel em até 1 minuto.
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(listarCatalogo());
});

// Fotos enviadas pelo painel (públicas: o site exibe nos cards). Nome de
// arquivo é único, então cache longo é seguro.
app.use(
  '/fotos',
  express.static(fotosDir, {
    immutable: true,
    maxAge: '30d',
    fallthrough: false,
  })
);

// Site em / e painel em /admin, servidos antes dos rate limiters para que
// assets (css, js, svg) não consumam a cota da API.
app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      const cacheControl = filePath.endsWith('.html')
        ? 'no-cache'
        : 'public, max-age=86400';
      res.setHeader('Cache-Control', cacheControl);
    },
  })
);

app.use(express.json({ limit: '8kb' }));

const limiterGeral = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições, tente novamente em instantes' },
  skip: (req) => req.path === '/health',
});

app.use(limiterGeral);

const limiterHandshake = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições de sessão, tente novamente em instantes' },
});

const limiterConversa = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas mensagens, tente novamente em instantes' },
});

const limiterFicha = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições, tente novamente em instantes' },
});

app.use((err, _req, res, next) => {
  if (!err) {
    return next();
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload muito grande' });
  }

  // Erros com status próprio (ex.: 404 de arquivo inexistente em /fotos).
  // Mensagem genérica para não vazar detalhes internos do parser.
  const status = Number(err.statusCode || err.status);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: status === 404 ? 'Não encontrado' : 'Erro na requisição' });
  }

  return res.status(400).json({ error: 'Requisição inválida' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'imo-weiss' });
});

// Atalho para quem digita /painel por costume.
app.get('/painel', (_req, res) => {
  res.redirect('/admin/');
});

app.post('/api/conversa/abrir', limiterHandshake, (req, res) => {
  const validacao = validarVisitorId(req.body?.visitorId);
  if (!validacao.ok) {
    return res.status(400).json({ error: validacao.erro });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    token: assinarTokenConversa(req.body.visitorId),
    validadeMs: TOKEN_CONVERSA_TTL_MS,
  });
});

app.post('/api/conversa', limiterConversa, async (req, res) => {
  const { ok, erro } = validarMensagem(req.body);
  if (!ok) {
    return res.status(400).json({ error: erro });
  }

  const visitorId = req.body.visitorId;
  const textoDoCliente = req.body.texto.trim();
  const token = req.get('x-conversa-token');

  if (!verificarTokenConversa(token, visitorId)) {
    return res.status(401).json({ error: 'Token de conversa inválido ou expirado' });
  }

  if (!respeitouIntervalo(visitorId)) {
    return res.status(429).json({ error: 'Aguarde um instante antes de enviar outra mensagem' });
  }

  try {
    res.setHeader('Cache-Control', 'no-store');
    const resposta = await conversar(visitorId, textoDoCliente, memoria);
    return res.json({ resposta });
  } catch (err) {
    console.error('Erro do assistente:', err.message);

    if (err.status) {
      return res.status(err.status).json({ error: 'Erro no serviço de IA' });
    }

    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// O chat do site envia a ficha coletada pelo assistente; ela é gravada no
// banco e aparece no painel na hora.
app.post('/api/ficha', limiterFicha, (req, res) => {
  const validacao = validarVisitorId(req.body?.visitorId);
  if (!validacao.ok) {
    return res.status(400).json({ error: validacao.erro });
  }

  const visitorId = req.body.visitorId;
  const token = req.get('x-conversa-token');
  if (!verificarTokenConversa(token, visitorId)) {
    return res.status(401).json({ error: 'Token de conversa inválido ou expirado' });
  }

  const campos = limparCamposFicha(req.body?.ficha);
  if (!campos) {
    return res.status(400).json({ error: 'ficha deve ser uma lista não vazia de { campo, valor }' });
  }

  const origem =
    typeof req.body?.origem === 'string' ? req.body.origem.trim().slice(0, MAX_TAMANHO_CAMPO) : undefined;

  try {
    salvarFicha(visitorId, campos, origem);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({ status: 'salvo' });
  } catch (err) {
    console.error('Erro ao gravar ficha:', err.message);
    return res.status(500).json({ error: 'Falha ao gravar a ficha' });
  }
});

app.listen(PORT, () => {
  console.log(`imo-weiss no ar na porta ${PORT}`);
});
