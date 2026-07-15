/* ============================================================
   S.J. Martins Corretor de Imóveis — painel administrativo
   Anúncios do site + fichas de clientes, tudo via /admin/api/*
   (protegido por login). Um anúncio salvo aqui entra no site na
   hora; as fichas chegam sozinhas pelo chat da Ana.
   ============================================================ */

const API = "/admin/api";

const ETAPAS = ["recebido", "conversando", "fechado"];
const ETAPA_ROTULO = { recebido: "Recebido", conversando: "Conversando", fechado: "Fechado" };

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

/* ---- utilidades ---- */

// Chamada à API do painel. Sessão expirada (401) volta para o login.
async function api(caminho, opcoes = {}) {
  const res = await fetch(`${API}${caminho}`, {
    headers: opcoes.body ? { "Content-Type": "application/json" } : undefined,
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined
  });

  if (res.status === 401) {
    window.location.href = "/admin/entrar";
    throw new Error("Sessão expirada");
  }
  if (!res.ok) {
    let mensagem = `Erro ${res.status}`;
    try {
      const dados = await res.json();
      if (dados.error) mensagem = dados.error;
    } catch {
      /* resposta sem JSON */
    }
    throw new Error(mensagem);
  }

  return res.status === 204 ? null : res.json();
}

const escapar = (str) =>
  String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const moeda = (valor) => {
  const n = Number(valor);
  if (!valor || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
};

const dataCurta = (valor) => {
  if (!valor) return "";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const nomeDaFicha = (campos) => {
  const nome = campos.find((c) => /nome/i.test(c.campo));
  return (nome ? nome.valor : campos[0]?.valor) || "Cliente";
};

// Formata como moeda apenas valores puramente numéricos ("850000",
// "R$ 850.000,00"); texto como "850 mil" fica como veio.
const valorDaFichaLegivel = (bruto) => {
  const s = String(bruto ?? "").trim();
  if (!/^R?\$?\s*[\d.,\s]+$/i.test(s)) return s;
  const digitos = s
    .replace(/[^\d,]/g, "")
    .replace(/,\d{1,2}$/, "")
    .replace(/,/g, "");
  const n = Number(digitos);
  if (!digitos || Number.isNaN(n)) return s;
  return moeda(n);
};

const tagsDaFicha = (campos) =>
  campos
    .filter((c) => !/nome/i.test(c.campo))
    .map((c) => {
      const valor = /valor|pre[çc]o|faixa/i.test(c.campo) ? valorDaFichaLegivel(c.valor) : c.valor;
      return `<span class="ficha-tag">${escapar(valor)}</span>`;
    })
    .join("");

const fichaEmTexto = (campos) => campos.map((c) => `${c.campo}: ${c.valor}`).join(" | ");

let avisoTimer;
const avisar = (mensagem) => {
  const el = $("[data-aviso]");
  el.textContent = mensagem;
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), 2600);
};

/* ---- estado ---- */

const estado = {
  anuncios: [],
  fichas: []
};

/* ---- carregamento ---- */

async function carregarTudo() {
  try {
    [estado.anuncios, estado.fichas] = await Promise.all([api("/anuncios"), api("/fichas")]);
    marcarConexao(true);
  } catch (err) {
    console.warn("Falha ao carregar:", err.message);
    marcarConexao(false);
  }
  desenharTudo();
}

function marcarConexao(ligado) {
  const el = $("[data-conexao]");
  el.classList.toggle("ligado", ligado);
  el.classList.toggle("desligado", !ligado);
  el.textContent = ligado ? "Conectado" : "Sem conexão";
}

/* ---- tela: RESUMO ---- */

function desenharResumo() {
  const ativos = estado.anuncios.filter((a) => a.situacao === "Ativo").length;
  const recebidas = estado.fichas.filter((f) => f.etapa === "recebido").length;

  $('[data-num="anuncios"]').textContent = estado.anuncios.length;
  $('[data-num="ativos"]').textContent = ativos;
  $('[data-num="fichas"]').textContent = estado.fichas.length;
  $('[data-num="recebidas"]').textContent = recebidas;

  const situacoes = ["Ativo", "Em negociação", "Vendido", "Alugado"];
  const teto = Math.max(1, ...situacoes.map((s) => estado.anuncios.filter((a) => a.situacao === s).length));
  $("[data-grafico]").innerHTML = situacoes
    .map((s) => {
      const total = estado.anuncios.filter((a) => a.situacao === s).length;
      return `<div class="barra-item"><span>${s}</span><div class="barra-trilho"><div class="barra-cheia" style="width:${
        (total / teto) * 100
      }%"></div></div><b>${total}</b></div>`;
    })
    .join("");

  const recentes = estado.fichas.slice(0, 5);
  $("[data-fichas-recentes]").innerHTML = recentes.length
    ? recentes
        .map(
          (f) => `<div class="ficha-mini">
            <strong>${escapar(nomeDaFicha(f.campos))}</strong>
            <div class="ficha-tags">${tagsDaFicha(f.campos)}</div>
            <small>${escapar([dataCurta(f.criadoEm), ETAPA_ROTULO[f.etapa]].filter(Boolean).join(" · "))}</small>
          </div>`
        )
        .join("")
    : '<p class="sem-dados">Nenhuma ficha ainda. Elas chegam pelo chat do site.</p>';
}

/* ---- tela: ANÚNCIOS ---- */

const classeDoSelo = (situacao) => {
  if (situacao === "Em negociação") return "selo negociando";
  if (situacao === "Vendido" || situacao === "Alugado") return "selo encerrado";
  return "selo";
};

function desenharAnuncios() {
  const termo = $("[data-filtro-anuncio-texto]").value.trim().toLowerCase();
  const situacao = $("[data-filtro-anuncio-situacao]").value;

  const lista = estado.anuncios.filter((a) => {
    const bateTermo =
      !termo ||
      [a.titulo, a.bairro, a.cidade, a.categoria].some((v) => String(v || "").toLowerCase().includes(termo));
    const bateSituacao = !situacao || a.situacao === situacao;
    return bateTermo && bateSituacao;
  });

  $("[data-anuncios-vazio]").hidden = estado.anuncios.length !== 0;

  $("[data-grade-anuncios]").innerHTML = lista
    .map((a) => {
      const foto = a.foto
        ? `<div class="anuncio-foto" style="background-image:url('${escapar(a.foto)}')"></div>`
        : `<div class="anuncio-foto">${escapar(a.categoria || "Imóvel")}</div>`;
      const ficha = [
        a.quartos ? `${a.quartos} qtos` : "",
        a.banheiros ? `${a.banheiros} banh.` : "",
        a.vagas ? `${a.vagas} vagas` : "",
        a.area ? `${a.area} m²` : ""
      ]
        .filter(Boolean)
        .join(" · ");
      return `<article class="anuncio">
        ${foto}
        <div class="anuncio-corpo">
          <span class="${classeDoSelo(a.situacao)}">${escapar(a.situacao)} · ${escapar(a.negocio || "")}</span>
          <h3>${escapar(a.titulo)}</h3>
          <span class="anuncio-preco">${moeda(a.preco)}</span>
          <span class="anuncio-meta">${escapar([a.bairro, a.cidade].filter(Boolean).join(", ") || "—")}</span>
          ${ficha ? `<span class="anuncio-meta">${escapar(ficha)}</span>` : ""}
          <div class="anuncio-acoes">
            <button class="botao vazado" data-editar="${a.id}" type="button">Editar</button>
            <button class="botao vazado" data-excluir="${a.id}" type="button">Excluir</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

/* ---- tela: FICHAS ---- */

function desenharFichas() {
  const termo = $("[data-filtro-ficha-texto]").value.trim().toLowerCase();
  const etapa = $("[data-filtro-ficha-etapa]").value;

  const lista = estado.fichas.filter((f) => {
    const bateTermo =
      !termo ||
      [fichaEmTexto(f.campos), f.origem, f.criadoEm].some((v) => String(v || "").toLowerCase().includes(termo));
    const bateEtapa = !etapa || f.etapa === etapa;
    return bateTermo && bateEtapa;
  });

  $("[data-fichas-vazio]").hidden = estado.fichas.length !== 0;

  $("[data-linhas-fichas]").innerHTML = lista
    .map((f) => {
      const opcoes = ETAPAS.map(
        (e) => `<option value="${e}" ${e === f.etapa ? "selected" : ""}>${ETAPA_ROTULO[e]}</option>`
      ).join("");
      const dados = f.campos.length
        ? `<span class="ficha-nome">${escapar(nomeDaFicha(f.campos))}</span><div class="ficha-tags">${tagsDaFicha(f.campos)}</div>`
        : "—";
      return `<tr>
        <td>${escapar(dataCurta(f.criadoEm) || "—")}</td>
        <td>${dados}</td>
        <td>${escapar(f.origem || "—")}</td>
        <td><select class="etapa-select ${escapar(f.etapa)}" data-etapa-ficha="${f.id}">${opcoes}</select></td>
        <td><button class="apagar" data-excluir-ficha="${f.id}" type="button">Excluir</button></td>
      </tr>`;
    })
    .join("");
}

function desenharTudo() {
  desenharResumo();
  desenharAnuncios();
  desenharFichas();
}

/* ---- exportação CSV ---- */

function baixarCsv(nomeArquivo, linhas) {
  const csv = linhas
    .map((linha) => linha.map((celula) => `"${String(celula ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = nomeArquivo;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ---- modal de anúncio ---- */

const veu = $("[data-veu]");
const formAnuncio = $("[data-form-anuncio]");

function abrirDialogo(anuncio) {
  formAnuncio.reset();
  $("[data-dialogo-titulo]").textContent = anuncio ? "Editar anúncio" : "Novo anúncio";
  const dica = $("[data-dica-foto]");
  dica.textContent = "JPG, PNG, WebP ou GIF até 5 MB. Enviar arquivo substitui a foto atual.";
  if (anuncio) {
    Object.entries(anuncio).forEach(([chave, valor]) => {
      if (formAnuncio.elements[chave]) formAnuncio.elements[chave].value = valor ?? "";
    });
    // Foto vinda de upload não é uma URL válida para o input type=url;
    // fica vazio e o submit preserva a foto atual se nada mudar.
    if (anuncio.foto && anuncio.foto.startsWith("/fotos/")) {
      formAnuncio.elements.foto.value = "";
      dica.textContent = "Este anúncio já tem foto enviada. Escolha um arquivo só se quiser trocá-la.";
    }
  } else {
    formAnuncio.elements.id.value = "";
  }
  veu.hidden = false;
}

const fecharDialogo = () => (veu.hidden = true);

// Envia a foto e devolve o caminho público (/fotos/...) para o campo "foto".
const MAX_FOTO_BYTES = 5 * 1024 * 1024;
async function enviarFoto(arquivo) {
  const res = await fetch(`${API}/foto`, {
    method: "POST",
    headers: { "Content-Type": arquivo.type },
    body: arquivo
  });

  if (res.status === 401) {
    window.location.href = "/admin/entrar";
    throw new Error("Sessão expirada");
  }
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados.error || `Erro ${res.status}`);
  return dados.url;
}

formAnuncio.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const dados = Object.fromEntries(new FormData(formAnuncio).entries());
  const id = dados.id;
  delete dados.id;
  delete dados.fotoArquivo;

  const arquivo = formAnuncio.elements.fotoArquivo?.files?.[0];
  if (arquivo && arquivo.size > MAX_FOTO_BYTES) {
    avisar("A foto deve ter no máximo 5 MB.");
    return;
  }

  try {
    if (arquivo) {
      avisar("Enviando foto…");
      dados.foto = await enviarFoto(arquivo);
    } else if (!dados.foto) {
      // Sem arquivo novo nem URL digitada: preserva a foto atual na edição.
      const atual = id && estado.anuncios.find((a) => a.id === id);
      if (atual?.foto) dados.foto = atual.foto;
    }

    if (id) {
      await api(`/anuncios/${encodeURIComponent(id)}`, { method: "PUT", body: dados });
    } else {
      await api("/anuncios", { method: "POST", body: dados });
    }
    estado.anuncios = await api("/anuncios");
    fecharDialogo();
    desenharTudo();
    avisar("Anúncio salvo. Já está no site.");
  } catch (err) {
    avisar(`Não foi possível salvar: ${err.message}`);
  }
});

/* ---- navegação entre telas ---- */

function trocarTela(nome) {
  $$("[data-tela]").forEach((el) => el.classList.toggle("ativa", el.dataset.tela === nome));
  $$("[data-aba]").forEach((el) => el.classList.toggle("ativa", el.dataset.aba === nome));
}

/* ---- eventos ---- */

function ligarEventos() {
  $$("[data-aba]").forEach((botao) => botao.addEventListener("click", () => trocarTela(botao.dataset.aba)));
  $$("[data-aba-link]").forEach((botao) => botao.addEventListener("click", () => trocarTela(botao.dataset.abaLink)));

  $("[data-novo-anuncio]").addEventListener("click", () => abrirDialogo(null));
  $("[data-recarregar]").addEventListener("click", () => {
    avisar("Atualizando…");
    carregarTudo();
  });

  $$("[data-fechar-dialogo]").forEach((botao) => botao.addEventListener("click", fecharDialogo));
  veu.addEventListener("click", (e) => {
    if (e.target === veu) fecharDialogo();
  });

  $("[data-filtro-anuncio-texto]").addEventListener("input", desenharAnuncios);
  $("[data-filtro-anuncio-situacao]").addEventListener("change", desenharAnuncios);
  $("[data-filtro-ficha-texto]").addEventListener("input", desenharFichas);
  $("[data-filtro-ficha-etapa]").addEventListener("change", desenharFichas);

  // ações nos cards de anúncio (delegação)
  $("[data-grade-anuncios]").addEventListener("click", async (e) => {
    const idEditar = e.target.getAttribute("data-editar");
    const idExcluir = e.target.getAttribute("data-excluir");
    if (idEditar) abrirDialogo(estado.anuncios.find((a) => a.id === idEditar));
    if (idExcluir && confirm("Excluir este anúncio? Ele sai do site também.")) {
      try {
        await api(`/anuncios/${encodeURIComponent(idExcluir)}`, { method: "DELETE" });
        estado.anuncios = estado.anuncios.filter((a) => a.id !== idExcluir);
        desenharTudo();
        avisar("Anúncio excluído.");
      } catch (err) {
        avisar(`Não foi possível excluir: ${err.message}`);
      }
    }
  });

  // etapa e exclusão de fichas
  $("[data-linhas-fichas]").addEventListener("change", async (e) => {
    const id = e.target.getAttribute("data-etapa-ficha");
    if (!id) return;
    const etapa = e.target.value;
    const ficha = estado.fichas.find((f) => String(f.id) === String(id));
    if (!ficha || !ETAPAS.includes(etapa) || ficha.etapa === etapa) return;

    const anterior = ficha.etapa;
    ficha.etapa = etapa;
    desenharResumo();
    desenharFichas();
    try {
      await api(`/fichas/${id}`, { method: "PATCH", body: { etapa } });
    } catch (err) {
      ficha.etapa = anterior;
      desenharResumo();
      desenharFichas();
      avisar(`Não foi possível mover a ficha: ${err.message}`);
    }
  });

  $("[data-linhas-fichas]").addEventListener("click", async (e) => {
    const id = e.target.getAttribute("data-excluir-ficha");
    if (!id) return;
    if (!confirm("Excluir esta ficha? Esta ação não pode ser desfeita.")) return;
    try {
      await api(`/fichas/${id}`, { method: "DELETE" });
      estado.fichas = estado.fichas.filter((f) => String(f.id) !== id);
      desenharTudo();
      avisar("Ficha excluída.");
    } catch (err) {
      avisar(`Não foi possível excluir: ${err.message}`);
    }
  });

  $("[data-exportar-anuncios]").addEventListener("click", () => {
    const cabecalho = ["Título", "Categoria", "Negócio", "Situação", "Preço", "Bairro", "Cidade", "Quartos", "Banheiros", "Vagas", "Área", "Detalhes"];
    const linhas = estado.anuncios.map((a) => [a.titulo, a.categoria, a.negocio, a.situacao, a.preco, a.bairro, a.cidade, a.quartos, a.banheiros, a.vagas, a.area, a.detalhes]);
    baixarCsv("anuncios-sjmartins.csv", [cabecalho, ...linhas]);
  });

  $("[data-exportar-fichas]").addEventListener("click", () => {
    const cabecalho = ["Data", "Dados", "Origem", "Etapa"];
    const linhas = estado.fichas.map((f) => [f.criadoEm, fichaEmTexto(f.campos), f.origem, ETAPA_ROTULO[f.etapa]]);
    baixarCsv("fichas-sjmartins.csv", [cabecalho, ...linhas]);
  });
}

/* ---- início ---- */

ligarEventos();
carregarTudo();
