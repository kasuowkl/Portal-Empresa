const EventEmitter = require('events');

const MAX_BUFFER = 500;

class BotLogger extends EventEmitter {
  constructor() {
    super();
    this.buffer = [];
  }

  log(categoria, mensagem, dados = null) {
    const entry = {
      ts: new Date().toISOString(),
      categoria,
      mensagem,
      dados,
    };
    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();

    // Console (mantém comportamento original)
    const prefix = `[${categoria}]`;
    if (categoria === 'erro') {
      console.error(`${prefix} ${mensagem}`, dados || '');
    } else {
      console.log(`${prefix} ${mensagem}`, dados ? JSON.stringify(dados) : '');
    }

    this.emit('log', entry);
  }

  getBuffer() {
    return this.buffer;
  }

  clear() {
    this.buffer = [];
  }
}

// Singleton
const logger = new BotLogger();

module.exports = logger;
