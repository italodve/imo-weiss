const MAX_TEXTO_MENSAGEM = 1000;
const MAX_VISITOR_ID = 100;
const PADRAO_VISITOR_ID = /^[a-zA-Z0-9-]{16,100}$/;

export function validarVisitorId(visitorId) {
  if (!visitorId || typeof visitorId !== 'string') {
    return { ok: false, erro: 'visitorId é obrigatório e deve ser uma string' };
  }

  if (visitorId.length > MAX_VISITOR_ID || !PADRAO_VISITOR_ID.test(visitorId)) {
    return { ok: false, erro: 'formato de visitorId inválido' };
  }

  return { ok: true };
}

export function validarMensagem(body) {
  const { visitorId, texto } = body || {};
  const visitante = validarVisitorId(visitorId);

  if (!visitante.ok) {
    return visitante;
  }

  if (!texto || typeof texto !== 'string') {
    return { ok: false, erro: 'texto é obrigatório e deve ser uma string' };
  }

  const normalizado = texto.trim();

  if (!normalizado) {
    return { ok: false, erro: 'texto não pode ser vazio' };
  }

  if (normalizado.length > MAX_TEXTO_MENSAGEM) {
    return { ok: false, erro: `texto excede o limite de ${MAX_TEXTO_MENSAGEM} caracteres` };
  }

  return { ok: true };
}
