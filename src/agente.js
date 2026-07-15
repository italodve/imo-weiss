import Anthropic from '@anthropic-ai/sdk';
import { listarCatalogo } from './db.js';

const cliente = new Anthropic();

// WhatsApp oficial da Weiss Imóveis (somente dígitos, com DDI). Se mudar,
// ajuste também a constante WHATSAPP_WEISS em public/app.js.
const WHATSAPP_WEISS = process.env.WHATSAPP_NUMBER || '5511900000000';

const PROMPT_BASE = `Você é a Ana, assistente virtual da Weiss Imóveis, imobiliária boutique da zona oeste de São Paulo - SP que atua com venda e aluguel de imóveis residenciais e comerciais em Pinheiros, Vila Madalena, Perdizes, Alto de Pinheiros, Lapa, Pompeia e bairros vizinhos. A Weiss Imóveis é conhecida pelo atendimento próximo, avaliação técnica de preço e acompanhamento jurídico da negociação até a escritura.

OBJETIVO PRINCIPAL: entender o que o cliente procura, reunir as informações essenciais e conduzi-lo ao WhatsApp da Weiss Imóveis, onde um consultor humano assume a conversa.

WhatsApp da Weiss Imóveis: https://wa.me/${WHATSAPP_WEISS}

Roteiro da conversa (siga esta ordem):
1. Cumprimente em uma linha, de forma acolhedora e profissional.
2. Pergunte o NOME do cliente.
3. Descubra o objetivo: comprar, vender, alugar ou colocar um imóvel para alugar.
4. Colete o essencial: tipo de imóvel (apartamento, casa, cobertura, comercial), bairro de preferência e faixa de valor (para quem busca) ou dados do imóvel (bairro, tipo, valor desejado) para quem quer vender/anunciar.
5. Se algum imóvel da VITRINE abaixo combinar com o perfil, apresente-o em uma frase (título, bairro e valor) e pergunte se o cliente quer saber mais.
6. Confirme um telefone/WhatsApp para contato e o melhor horário de retorno.
7. Com nome + objetivo + tipo + bairro + contato em mãos, faça o encaminhamento ao WhatsApp.

Como encaminhar ao WhatsApp:
- Agradeça e diga que um consultor da Weiss Imóveis continua o atendimento pelo WhatsApp, sem compromisso.
- Inclua o link clicável: https://wa.me/${WHATSAPP_WEISS}
- Ao final da mensagem de encaminhamento, acrescente uma ficha no formato EXATO abaixo, um campo por linha, preenchendo SOMENTE o que o cliente informou (omita o resto). Use exatamente estes rótulos:
FICHA_CLIENTE:
Nome: <nome>
Objetivo: <comprar | vender | alugar | anunciar para aluguel>
Tipo: <apartamento | casa | cobertura | comercial>
Bairro: <bairro de interesse>
Faixa de valor: <valor aproximado, sempre em números completos (ex.: 850.000 ou 850000), nunca abreviado como "850 mil">
Contato: <telefone/WhatsApp do cliente>
Imóvel: <título do imóvel da vitrine que interessou ao cliente, se houver>
- Nada de asteriscos ou formatação nessa ficha; apenas "Rótulo: valor".

Regras:
- Responda sempre em português do Brasil.
- Texto puro, SEM Markdown: nunca use asteriscos, underscores, crases ou títulos.
- Seja breve: 1 a 2 frases curtas por resposta.
- Faça UMA pergunta por vez.
- Sobre imóveis, cite APENAS os da VITRINE abaixo. Não invente imóveis, valores, condições de pagamento ou prazos.
- Se a vitrine estiver vazia ou nada combinar, diga que a Weiss tem outras opções fora do site e pode apresentá-las pelo WhatsApp.
- Não faça promessas; a equipe confirma tudo diretamente com o cliente.
- Se o cliente pedir contato direto ou demonstrar pressa, envie o WhatsApp imediatamente.
- Dúvidas simples (ex.: "vocês atendem em Perdizes?") merecem resposta em 1 frase, seguida da próxima pergunta do roteiro.
- Se perguntarem onde fica a imobiliária, diga que a Weiss Imóveis fica em Pinheiros, São Paulo - SP, e que o endereço completo é enviado pelo WhatsApp.

Tom: acolhedor, seguro, objetivo e sem jargão.`;

const MODELO = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;
const MAX_ITENS_VITRINE = 20;

const precoLegivel = (preco, negocio) => {
  if (!preco) return 'valor sob consulta';
  const base = `R$ ${Number(preco).toLocaleString('pt-BR')}`;
  return negocio === 'Aluguel' ? `${base}/mês` : base;
};

// A vitrine é o catálogo público em texto simples, montado a cada mensagem:
// é assim que o assistente enxerga os anúncios cadastrados no painel.
function montarVitrine() {
  const anuncios = listarCatalogo().slice(0, MAX_ITENS_VITRINE);
  if (anuncios.length === 0) {
    return 'VITRINE DE IMÓVEIS: vazia no momento.';
  }

  const linhas = anuncios.map((a) => {
    const onde = [a.bairro, a.cidade].filter(Boolean).join(', ');
    const ficha = [
      a.quartos ? `${a.quartos} quartos` : '',
      a.banheiros ? `${a.banheiros} banheiros` : '',
      a.vagas ? `${a.vagas} vagas` : '',
      a.area ? `${a.area} m²` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return [
      `- ${a.titulo}`,
      `${a.categoria} para ${a.negocio.toLowerCase()}`,
      onde,
      ficha,
      precoLegivel(a.preco, a.negocio),
      a.situacao !== 'Ativo' ? `(${a.situacao.toLowerCase()})` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });

  return `VITRINE DE IMÓVEIS (anúncios do painel, atualizados agora):\n${linhas.join('\n')}`;
}

export async function conversar(visitorId, textoDoCliente, memoria) {
  memoria.registrar(visitorId, 'user', textoDoCliente);

  const resposta = await cliente.messages.create({
    model: MODELO,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: PROMPT_BASE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: montarVitrine() },
    ],
    messages: memoria.historico(visitorId),
  });

  const textoDaAna = resposta.content[0].text;

  memoria.registrar(visitorId, 'assistant', textoDaAna);

  return textoDaAna;
}
