/* ============================================================
   Weiss Imóveis — site público
   Vitrine dinâmica (API /api/catalogo) + chat com a Ana (Claude)
   ============================================================ */

// WhatsApp oficial da Weiss (somente dígitos, com DDI). Se mudar, mantenha
// igual ao WHATSAPP_NUMBER do backend e aos links wa.me do index.html.
const WHATSAPP_WEISS = "5511900000000";

// Base da API. Vazio = mesma origem (site e API no mesmo servidor).
const API_BASE = "";

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

/* ---- cabeçalho e menu ---- */

const topo = $("[data-topo]");
const botaoMenu = $("[data-botao-menu]");
const navegacao = $("[data-navegacao]");

const aoRolar = () => topo?.classList.toggle("rolou", window.scrollY > 20);
window.addEventListener("scroll", aoRolar, { passive: true });
aoRolar();

botaoMenu?.addEventListener("click", () => {
  const abrir = !topo.classList.contains("menu-aberto");
  topo.classList.toggle("menu-aberto", abrir);
  botaoMenu.setAttribute("aria-expanded", String(abrir));
  botaoMenu.setAttribute("aria-label", abrir ? "Fechar menu" : "Abrir menu");
});

navegacao?.addEventListener("click", (e) => {
  if (e.target instanceof HTMLAnchorElement) {
    topo.classList.remove("menu-aberto");
    botaoMenu?.setAttribute("aria-expanded", "false");
  }
});

/* ---- animação de entrada ---- */

const alvos = $$("[data-surgir]");
const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (semMovimento || !("IntersectionObserver" in window)) {
  alvos.forEach((el) => el.classList.add("visivel"));
} else {
  const observador = new IntersectionObserver(
    (entradas, obs) => {
      entradas.forEach((entrada) => {
        if (!entrada.isIntersecting) return;
        entrada.target.classList.add("visivel");
        obs.unobserve(entrada.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );
  alvos.forEach((el) => observador.observe(el));
}

/* ---- formulário de contato → WhatsApp ---- */

$("[data-formulario]")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const dados = new FormData(e.target);
  const linhas = [
    "Olá, Weiss Imóveis!",
    `Meu nome é ${dados.get("nome") || ""}.`,
    `Meu WhatsApp é ${dados.get("telefone") || ""}.`,
    `Objetivo: ${dados.get("objetivo") || ""}.`,
    dados.get("detalhes") ? `Detalhes: ${dados.get("detalhes")}` : ""
  ].filter(Boolean);

  window.open(
    `https://wa.me/${WHATSAPP_WEISS}?text=${encodeURIComponent(linhas.join("\n"))}`,
    "_blank",
    "noopener,noreferrer"
  );
});

/* ============================================================
   VITRINE — imóveis vindos do painel via /api/catalogo
   ============================================================ */

const escapar = (str) =>
  String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Amostra exibida quando a API está fora do ar ou o painel ainda está vazio.
const AMOSTRA = [
  { titulo: "Apartamento com varanda verde", categoria: "Apartamento", negocio: "Venda", bairro: "Pinheiros", cidade: "São Paulo", quartos: 2, banheiros: 2, vagas: 1, area: 74, preco: 890000 },
  { titulo: "Casa de vila reformada", categoria: "Casa", negocio: "Venda", bairro: "Vila Madalena", cidade: "São Paulo", quartos: 3, banheiros: 2, vagas: 1, area: 120, preco: 1450000 },
  { titulo: "Studio pronto para morar", categoria: "Apartamento", negocio: "Aluguel", bairro: "Perdizes", cidade: "São Paulo", quartos: 1, banheiros: 1, vagas: 1, area: 38, preco: 3200 }
];

// Ilustração de fallback por categoria (SVG inline — nenhum arquivo externo).
const arteDaCategoria = (categoria) => {
  const c = String(categoria || "").toLowerCase();
  const casa = "M20 95 L100 40 L180 95 M45 90 v55 h110 v-55";
  const predio = "M60 30 h80 v115 h-80 z M78 50 h14 v14 h-14 z M108 50 h14 v14 h-14 z M78 80 h14 v14 h-14 z M108 80 h14 v14 h-14 z M78 110 h14 v14 h-14 z M108 110 h14 v14 h-14 z";
  const loja = "M35 70 h130 v75 h-130 z M35 70 L50 40 h100 l15 30 M60 100 h40 v45 h-40 z M115 100 h35 v25 h-35 z";
  const desenho = c.includes("casa") || c.includes("terreno") ? casa : c.includes("comerc") ? loja : predio;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160">` +
    `<rect width="200" height="160" fill="#eaf2ee"/>` +
    `<circle cx="168" cy="26" r="14" fill="#f2c94c" opacity="0.8"/>` +
    `<path d="${desenho}" fill="none" stroke="#14544a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const precoLegivel = (preco, negocio) => {
  const n = Number(String(preco ?? "").replace(/[^\d]/g, ""));
  if (!n) return "Sob consulta";
  const base = n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  return /alug|loca/i.test(String(negocio)) ? `${base}/mês` : base;
};

const estadoVitrine = {
  anuncios: AMOSTRA,
  negocio: "", // "", "venda" ou "aluguel"
};

const cartaoHtml = (a) => {
  const onde = [a.bairro, a.cidade].filter(Boolean).join(", ");
  const ficha = [
    a.quartos ? `${a.quartos} quartos` : "",
    a.banheiros ? `${a.banheiros} banheiros` : "",
    a.vagas ? `${a.vagas} vagas` : "",
    a.area ? `${a.area} m²` : ""
  ]
    .filter(Boolean)
    .map((item) => `<li>${escapar(item)}</li>`)
    .join("");
  const foto = a.foto && /^(https?:\/\/|\/fotos\/)/i.test(a.foto) ? a.foto : arteDaCategoria(a.categoria);
  const mensagem = `Olá, Weiss! Tenho interesse no imóvel "${a.titulo}"${onde ? ` (${onde})` : ""}.`;
  const whatsapp = `https://wa.me/${WHATSAPP_WEISS}?text=${encodeURIComponent(mensagem)}`;

  return `<article class="cartao-imovel">
    <img src="${escapar(foto)}" alt="${escapar(a.titulo)}" loading="lazy" />
    <div class="cartao-corpo">
      <div class="cartao-topo">
        <span class="cartao-negocio">${/alug/i.test(a.negocio) ? "Aluguel" : "Venda"}</span>
        <span class="cartao-onde">${escapar([a.categoria, onde].filter(Boolean).join(" · "))}</span>
      </div>
      <h3>${escapar(a.titulo)}</h3>
      ${ficha ? `<ul class="cartao-ficha">${ficha}</ul>` : ""}
    </div>
    <div class="cartao-pe">
      <span class="cartao-preco">${escapar(precoLegivel(a.preco, a.negocio))}</span>
      <a class="botao contorno miudo" href="${escapar(whatsapp)}" target="_blank" rel="noopener noreferrer">Tenho interesse</a>
    </div>
  </article>`;
};

// Minúsculas e sem acentos, para "Vila Madalena" casar com "vila madalena".
const simplificar = (str) =>
  String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const filtrar = () => {
  const q = simplificar($("[data-busca-texto]")?.value.trim());
  const categoria = $("[data-busca-categoria]")?.value || "";
  const bairro = $("[data-busca-bairro]")?.value || "";
  const quartosMin = Number($("[data-busca-quartos]")?.value) || 0;
  const teto = Number($("[data-busca-teto]")?.value) || 0;

  return estadoVitrine.anuncios.filter((a) => {
    if (q && !simplificar([a.titulo, a.detalhes, a.bairro, a.cidade, a.categoria].join(" ")).includes(q)) return false;
    if (estadoVitrine.negocio === "venda" && /alug/i.test(a.negocio)) return false;
    if (estadoVitrine.negocio === "aluguel" && !/alug/i.test(a.negocio)) return false;
    if (categoria && simplificar(a.categoria) !== categoria) return false;
    if (bairro && (a.bairro || "") !== bairro) return false;
    if (quartosMin && !(Number(a.quartos) >= quartosMin)) return false;
    if (teto && !(Number(a.preco) > 0 && Number(a.preco) <= teto)) return false;
    return true;
  });
};

const desenharVitrine = () => {
  const alvo = $("[data-cartoes]");
  if (!alvo) return;

  const visiveis = filtrar();
  alvo.innerHTML = visiveis.map(cartaoHtml).join("");
  const vazio = $("[data-busca-vazia]");
  if (vazio) vazio.hidden = visiveis.length > 0;
};

const preencherBairros = () => {
  const select = $("[data-busca-bairro]");
  if (!select) return;

  const atual = select.value;
  const bairros = [...new Set(estadoVitrine.anuncios.map((a) => a.bairro).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );

  select.innerHTML = '<option value="">Todos</option>';
  for (const bairro of bairros) {
    const opcao = document.createElement("option");
    opcao.value = bairro;
    opcao.textContent = bairro;
    select.appendChild(opcao);
  }
  if ([...select.options].some((o) => o.value === atual)) select.value = atual;
};

const carregarCatalogo = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/catalogo`);
    if (!res.ok) throw new Error(`catalogo ${res.status}`);
    const anuncios = await res.json();
    if (Array.isArray(anuncios) && anuncios.length > 0) {
      estadoVitrine.anuncios = anuncios.filter((a) => a.titulo);
    }
  } catch (erro) {
    // API indisponível: a amostra embutida continua no lugar.
    console.warn("Catálogo indisponível:", erro?.message || erro);
  }
  preencherBairros();
  desenharVitrine();
};

$("[data-busca]")?.addEventListener("submit", (e) => {
  e.preventDefault();
  desenharVitrine();
});
$$("[data-aba-negocio]").forEach((aba) => {
  aba.addEventListener("click", () => {
    estadoVitrine.negocio = aba.getAttribute("data-aba-negocio") || "";
    $$("[data-aba-negocio]").forEach((outra) => {
      const ativa = outra === aba;
      outra.classList.toggle("ativa", ativa);
      outra.setAttribute("aria-pressed", String(ativa));
    });
    desenharVitrine();
  });
});
$("[data-busca-texto]")?.addEventListener("input", desenharVitrine);
["[data-busca-categoria]", "[data-busca-bairro]", "[data-busca-quartos]", "[data-busca-teto]"].forEach((sel) =>
  $(sel)?.addEventListener("change", desenharVitrine)
);

carregarCatalogo();

/* ============================================================
   CHAT — conversa com a Ana (assistente de IA)
   ============================================================ */

const chat = $("[data-chat]");
const chatCorpo = $("[data-chat-corpo]");
const chatForm = $("[data-chat-form]");
const chatInput = $("[data-chat-input]");
const chatSaudacao = $("[data-chat-saudacao]");

// visitorId precisa casar com o padrão do backend: /^[a-zA-Z0-9-]{16,100}$/
const PADRAO_VISITOR = /^[a-zA-Z0-9-]{16,100}$/;
const novoVisitorId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

// Persistência no navegador: lembra o visitante e o que ele já contou, para
// não repetir perguntas em visitas futuras. Tolera localStorage bloqueado.
const CHAVE_STORAGE = "weiss_conversa";
const lerGuardado = () => {
  try {
    return JSON.parse(window.localStorage.getItem(CHAVE_STORAGE) || "{}") || {};
  } catch {
    return {};
  }
};
const guardar = (dados) => {
  try {
    window.localStorage.setItem(CHAVE_STORAGE, JSON.stringify(dados));
  } catch {
    /* segue só em memória */
  }
};

const guardado = lerGuardado();
const visitorGuardado =
  typeof guardado.visitorId === "string" && PADRAO_VISITOR.test(guardado.visitorId)
    ? guardado.visitorId
    : null;

const conversa = {
  visitorId: visitorGuardado || novoVisitorId(),
  voltou: Boolean(visitorGuardado),
  token: null,
  tokenExpiraEm: 0,
  comecou: false,
  enviando: false,
  fichaEnviadaChave: null,
  ficha: Array.isArray(guardado.ficha) ? guardado.ficha : [] // { campo, valor }
};

const persistirConversa = () => guardar({ visitorId: conversa.visitorId, ficha: conversa.ficha });
persistirConversa();

// Acumula campos novos na ficha (sobrescreve por rótulo) e persiste.
const acumularFicha = (campos) => {
  if (!campos || campos.length === 0) return;
  for (const item of campos) {
    const idx = conversa.ficha.findIndex((f) => f.campo === item.campo);
    if (idx >= 0) conversa.ficha[idx] = item;
    else conversa.ficha.push(item);
  }
  persistirConversa();
};

const valorDaFicha = (...campos) => conversa.ficha.find((f) => campos.includes(f.campo))?.valor;

// As respostas são exibidas como texto puro; remove eventual Markdown residual.
const limparMarkdown = (texto) =>
  String(texto)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$)/g, "$1$2")
    .replace(/(^|\s)_(\S.*?\S|\S)_(?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");

const REGEX_LINK_WHATS = /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/\S+/i;
const REGEX_FICHA = /FICHA_CLIENTE:?/i;

// Telefone de um link wa.me/api.whatsapp.com; cai no número padrão se faltar.
const telefoneDoLink = (url) => {
  const direto = url.match(/wa\.me\/(\d+)/i);
  if (direto) return direto[1];
  const query = url.match(/[?&]phone=(\d+)/i);
  if (query) return query[1];
  return WHATSAPP_WEISS;
};

// Extrai os pares "Rótulo: valor" do bloco FICHA_CLIENTE da resposta da Ana.
const extrairFicha = (texto) => {
  const inicio = texto.search(REGEX_FICHA);
  if (inicio === -1) return null;

  const campos = [];
  const linhas = texto.slice(inicio).replace(REGEX_FICHA, "").split("\n");
  for (const bruta of linhas) {
    const linha = limparMarkdown(bruta).replace(/[*_`]/g, "").replace(/^[-•]\s*/, "").trim();
    const par = linha.match(/^([\wÀ-ÿ/ ]{2,40}?):\s*(.+)$/);
    if (!par) continue;
    const valor = par[2].trim();
    if (!valor || /^https?:\/\//i.test(valor) || /^<.*>$/.test(valor)) continue;
    campos.push({ campo: par[1].trim().toLowerCase(), valor });
  }

  return campos.length ? campos : null;
};

const objetivoEmFrase = (t) => {
  const x = t.toLowerCase();
  if (x.includes("comprar")) return "comprar um imóvel";
  if (x.includes("vender")) return "vender um imóvel";
  if (x.includes("anunciar")) return "colocar um imóvel para alugar";
  if (x.includes("alugar")) return "alugar um imóvel";
  if (x.includes("avalia")) return "avaliar um imóvel";
  return `o seguinte: ${t}`;
};

// Mensagem natural para o WhatsApp montada a partir da ficha coletada.
const mensagemDaFicha = (campos) => {
  const mapa = {};
  for (const { campo, valor } of campos) mapa[campo] = valor;

  const frases = ["Olá, Weiss Imóveis!"];
  frases.push(mapa["nome"] ? `Meu nome é ${mapa["nome"]} e falei com a Ana no site.` : "Falei com a Ana no site.");
  if (mapa["objetivo"]) frases.push(`Quero ${objetivoEmFrase(mapa["objetivo"])}.`);
  if (mapa["tipo"]) frases.push(`Tipo de imóvel: ${mapa["tipo"]}.`);
  if (mapa["bairro"]) frases.push(`Bairro de interesse: ${mapa["bairro"]}.`);
  if (mapa["faixa de valor"]) frases.push(`Faixa de valor: ${mapa["faixa de valor"]}.`);
  if (mapa["imóvel"] || mapa["imovel"]) frases.push(`Me interessei pelo imóvel: ${mapa["imóvel"] || mapa["imovel"]}.`);

  const conhecidos = new Set(["nome", "objetivo", "tipo", "bairro", "faixa de valor", "imóvel", "imovel", "contato", "telefone", "whatsapp"]);
  for (const { campo, valor } of campos) {
    if (!conhecidos.has(campo)) frases.push(`${campo.charAt(0).toUpperCase()}${campo.slice(1)}: ${valor}.`);
  }

  const contato = mapa["contato"] || mapa["telefone"] || mapa["whatsapp"];
  if (contato) frases.push(`Meu contato é ${contato}.`);

  return frases.join(" ");
};

const linkWhatsapp = (urlOriginal, camposNovos) => {
  const telefone = telefoneDoLink(urlOriginal || `https://wa.me/${WHATSAPP_WEISS}`);
  const campos = camposNovos && camposNovos.length > 0 ? camposNovos : conversa.ficha;
  const texto =
    campos && campos.length > 0
      ? mensagemDaFicha(campos)
      : "Olá, Weiss Imóveis! Falei com a Ana no site e gostaria de continuar a conversa.";
  return `https://wa.me/${telefone}?text=${encodeURIComponent(texto)}`;
};

const adicionarBalao = (texto, tipo = "ana") => {
  if (!chatCorpo) return null;
  const balao = document.createElement("div");
  balao.className = `balao ${tipo}`;
  balao.textContent = tipo.startsWith("ana") ? limparMarkdown(texto) : texto;
  chatCorpo.appendChild(balao);
  chatCorpo.scrollTop = chatCorpo.scrollHeight;
  return balao;
};

const anexarBotaoWhats = (balao, url, rotulo = "Continuar no WhatsApp") => {
  if (!balao) return;
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "balao-whats";
  link.textContent = rotulo;
  balao.appendChild(document.createElement("br"));
  balao.appendChild(link);
};

// Garante um token de conversa válido (renova com folga antes de expirar).
const garantirToken = async () => {
  if (conversa.token && Date.now() < conversa.tokenExpiraEm - 30000) {
    return conversa.token;
  }

  const res = await fetch(`${API_BASE}/api/conversa/abrir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorId: conversa.visitorId })
  });
  if (!res.ok) throw new Error(`abrir ${res.status}`);

  const dados = await res.json();
  conversa.token = dados.token;
  conversa.tokenExpiraEm = Date.now() + (Number(dados.validadeMs) || 0);
  return conversa.token;
};

const enviarParaAna = async (texto) => {
  const chamada = async (token) =>
    fetch(`${API_BASE}/api/conversa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Conversa-Token": token },
      body: JSON.stringify({ visitorId: conversa.visitorId, texto })
    });

  let res = await chamada(await garantirToken());

  if (res.status === 401) {
    // Token vencido no meio do caminho: renova uma vez e repete.
    conversa.token = null;
    res = await chamada(await garantirToken());
  }

  if (!res.ok) throw new Error(`conversa ${res.status}`);
  return (await res.json()).resposta;
};

// Grava a ficha no backend (fire-and-forget); não trava o fluxo do WhatsApp.
const gravarFicha = async (campos) => {
  if (!campos || campos.length === 0) return;

  const chave = JSON.stringify(campos);
  if (conversa.fichaEnviadaChave === chave) return;
  conversa.fichaEnviadaChave = chave;

  try {
    const token = await garantirToken();
    await fetch(`${API_BASE}/api/ficha`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Conversa-Token": token },
      body: JSON.stringify({
        visitorId: conversa.visitorId,
        ficha: campos,
        origem: window.location.href
      })
    });
  } catch {
    conversa.fichaEnviadaChave = null;
  }
};

const habilitarEntrada = (ligado) => {
  if (chatInput) chatInput.disabled = !ligado;
  const botao = chatForm?.querySelector("button[type='submit']");
  if (botao) botao.disabled = !ligado;
};

const iniciarConversa = () => {
  if (conversa.comecou) return;
  conversa.comecou = true;
  if (chatSaudacao) {
    const nome = valorDaFicha("nome");
    chatSaudacao.textContent =
      conversa.voltou && nome
        ? `Que bom te ver de novo, ${nome}! Quer continuar de onde paramos ou falar de outro imóvel?`
        : conversa.voltou
          ? "Oi de novo! Quer continuar nossa conversa ou falar de outra coisa?"
          : "Oi! Eu sou a Ana, da Weiss Imóveis. Você quer comprar, vender ou alugar um imóvel?";
  }
  chatInput?.focus();
};

$("[data-chat-abrir]")?.addEventListener("click", () => {
  chat?.classList.toggle("aberto");
  if (chat?.classList.contains("aberto")) iniciarConversa();
});

$("[data-chat-fechar]")?.addEventListener("click", () => chat?.classList.remove("aberto"));

chatForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (conversa.enviando) return;

  const texto = chatInput.value.trim();
  if (!texto) return;

  adicionarBalao(texto, "cliente");
  chatInput.value = "";
  conversa.enviando = true;
  habilitarEntrada(false);

  const digitando = adicionarBalao("Digitando…", "ana");

  try {
    const resposta = await enviarParaAna(texto);
    digitando?.remove();

    // Guarda o que a Ana já reconheceu, para aproveitar em visitas futuras.
    const camposNovos = extrairFicha(resposta);
    acumularFicha(camposNovos);

    const linkNoTexto = resposta.match(REGEX_LINK_WHATS);
    if (linkNoTexto) {
      // Encaminhamento: grava a ficha, limpa o bloco FICHA_CLIENTE do texto
      // exibido e abre o WhatsApp com a mensagem montada.
      gravarFicha(conversa.ficha.length > 0 ? conversa.ficha : camposNovos);
      const url = linkWhatsapp(linkNoTexto[0], camposNovos);
      const textoLimpo = resposta
        .replace(REGEX_FICHA, "")
        .replace(REGEX_LINK_WHATS, "")
        .split("\n")
        .filter((linha) => !/^\s*[\wÀ-ÿ/ ]{2,40}?:\s*.+$/.test(linha))
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim();
      const balao = adicionarBalao(textoLimpo || "Vou te passar para o WhatsApp da Weiss.", "ana");
      anexarBotaoWhats(balao, url);
      // Tenta abrir direto (pode ser bloqueado; o botão acima cobre isso).
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      adicionarBalao(resposta, "ana");
    }
  } catch (erro) {
    digitando?.remove();
    const balaoErro = adicionarBalao(
      "Tive um problema para responder agora. Você pode falar direto com a equipe da Weiss pelo WhatsApp.",
      "ana erro"
    );
    anexarBotaoWhats(balaoErro, linkWhatsapp(), "Falar no WhatsApp");
  } finally {
    conversa.enviando = false;
    habilitarEntrada(true);
    chatInput?.focus();
  }
});
