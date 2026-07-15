const MAX_TURNOS_POR_CONVERSA = 20;
const MAX_CONVERSAS = 500;

// Memória de conversa em processo (Map). Cada visitante tem um histórico
// curto que alimenta o assistente. Para escalar horizontalmente, troque as
// operações do Map por um armazenamento compartilhado (ex.: Redis).
export class MemoriaConversas {
  constructor() {
    this.conversas = new Map();
  }

  historico(visitorId) {
    return this.conversas.get(visitorId) || [];
  }

  registrar(visitorId, role, content) {
    if (this.conversas.size >= MAX_CONVERSAS && !this.conversas.has(visitorId)) {
      const maisAntiga = this.conversas.keys().next().value;
      if (maisAntiga) {
        this.conversas.delete(maisAntiga);
      }
    }

    const historico = this.historico(visitorId);
    historico.push({ role, content });
    this.conversas.set(visitorId, historico.slice(-MAX_TURNOS_POR_CONVERSA));
  }

  encerrar(visitorId) {
    this.conversas.delete(visitorId);
  }
}
