/**
 * ARQUIVO: lib/ad.js
 * VERSÃO:  1.1.0
 * DATA:    2026-03-03
 * DESCRIÇÃO: Helper para operações com Active Directory via LDAP
 * HISTÓRICO:
 * 1.0.0 - 2026-03-03 - Versão inicial (bind DOMAIN\user)
 * 1.1.0 - 2026-03-03 - Alterado para UPN (user@domain); corrigido escape de filtro LDAP
 * 1.2.0 - 2026-03-03 - ldapjs v3 retorna atributos como arrays; adicionado helper str() para normalizar
 */

const ldap = require('ldapjs');
const sql  = require('mssql');

const TIMEOUT_MS = 8000;

// ============================================================
// Lê configurações do AD salvas na tabela configuracoes
// ============================================================
async function lerConfigAD(pool) {
  const resultado = await pool.request()
    .input('grupo', sql.VarChar, 'ad')
    .query('SELECT chave, valor FROM configuracoes WHERE grupo = @grupo');

  const config = {};
  resultado.recordset.forEach(r => { config[r.chave] = r.valor; });
  return config;
}

// ============================================================
// Verifica se o AD está configurado
// ============================================================
function configValida(config) {
  return config.ad_servidor && config.ad_basedn && config.ad_dominio;
}

// ============================================================
// Cria cliente LDAP
// ============================================================
function criarCliente(config) {
  return ldap.createClient({
    url:            `ldap://${config.ad_servidor}:${config.ad_porta || 389}`,
    timeout:        TIMEOUT_MS,
    connectTimeout: TIMEOUT_MS,
    reconnect:      false
  });
}

// ============================================================
// Autentica um usuário contra o AD (bind com suas credenciais)
// Retorna: true (autenticado) | lança erro (falha)
// ============================================================
function autenticarUsuario(config, login, senha) {
  return new Promise((resolve, reject) => {
    const client = criarCliente(config);
    const bindDN = `${login}@${config.ad_dominio}`;

    client.on('error', (err) => {
      client.destroy();
      reject(err);
    });

    client.bind(bindDN, senha, (err) => {
      client.destroy();
      if (err) reject(err);
      else     resolve(true);
    });
  });
}

// ============================================================
// Testa a conexão com o AD usando a conta de serviço
// Retorna: true | lança erro
// ============================================================
function testarConexao(config) {
  return autenticarUsuario(config, config.ad_usuario_svc, config.ad_senha_svc);
}

// ============================================================
// Lista todos os usuários ativos do AD
// Retorna: [{ login, nome, email, departamento }]
// ============================================================
function listarUsuariosAD(config) {
  return new Promise((resolve, reject) => {
    const client = criarCliente(config);
    const bindDN = `${config.ad_usuario_svc}@${config.ad_dominio}`;

    client.on('error', (err) => {
      client.destroy();
      reject(err);
    });

    client.bind(bindDN, config.ad_senha_svc, (errBind) => {
      if (errBind) {
        client.destroy();
        return reject(new Error('Falha ao autenticar conta de serviço: ' + errBind.message));
      }

      const opcoesBusca = {
        // Filtro amplo: retorna tudo que tem sAMAccountName (contas de usuário e computador)
        // Contas de computador são excluídas abaixo pelo sufixo '$'
        filter:     '(sAMAccountName=*)',
        scope:      'sub',
        attributes: ['sAMAccountName', 'displayName', 'mail', 'department', 'title', 'mobile', 'telephoneNumber']
      };

      const usuarios = [];

      // Lê um atributo do entry de forma compatível com ldapjs v2 e v3
      function lerAtributo(entry, nome) {
        // Tenta entry.attributes (array de Attribute objects) — mais confiável no v3
        if (Array.isArray(entry.attributes)) {
          const attr = entry.attributes.find(
            a => a.type && a.type.toLowerCase() === nome.toLowerCase()
          );
          if (attr) {
            const vals = attr.values || attr._vals || [];
            const first = Array.isArray(vals) ? vals[0] : vals;
            return first ? first.toString() : '';
          }
        }
        // Fallback: entry.object
        const obj = entry.object || {};
        const v   = obj[nome];
        if (v === undefined || v === null) return '';
        return Array.isArray(v) ? (v[0] ? v[0].toString() : '') : v.toString();
      }

      client.search(config.ad_basedn, opcoesBusca, (errSearch, res) => {
        if (errSearch) {
          client.destroy();
          return reject(errSearch);
        }

        res.on('searchEntry', (entry) => {
          const login = lerAtributo(entry, 'sAMAccountName');

          // Ignora entradas sem login e contas de computador (terminam em '$')
          if (!login || login.endsWith('$')) return;

          const mobile = lerAtributo(entry, 'mobile') || lerAtributo(entry, 'telephoneNumber') || '';
          usuarios.push({
            login:        login,
            nome:         lerAtributo(entry, 'displayName') || login,
            email:        lerAtributo(entry, 'mail'),
            departamento: lerAtributo(entry, 'department'),
            cargo:        lerAtributo(entry, 'title'),
            whatsapp:     mobile.replace(/\D/g, '').slice(0, 20),
          });
        });

        res.on('error', (err) => {
          client.destroy();
          reject(err);
        });

        res.on('end', () => {
          client.destroy();
          resolve(
            usuarios.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
          );
        });
      });
    });
  });
}

// ============================================================
// Busca dados de um usuário específico no AD
// ============================================================
function buscarUsuarioAD(config, login) {
  return new Promise((resolve, reject) => {
    const client = criarCliente(config);
    const bindDN = `${config.ad_usuario_svc}@${config.ad_dominio}`;

    client.on('error', (err) => {
      client.destroy();
      reject(err);
    });

    client.bind(bindDN, config.ad_senha_svc, (errBind) => {
      if (errBind) {
        client.destroy();
        return reject(errBind);
      }

      const opcoesBusca = {
        filter:     `(&(objectClass=user)(sAMAccountName=${login.replace(/[\\*()\x00]/g, '')}))`,
        scope:      'sub',
        attributes: ['sAMAccountName', 'displayName', 'mail', 'department']
      };

      client.search(config.ad_basedn, opcoesBusca, (errSearch, res) => {
        if (errSearch) {
          client.destroy();
          return reject(errSearch);
        }

        let usuario = null;

        res.on('searchEntry', (entry) => {
          const obj = entry.pojo || entry.object || {};
          const str = v => Array.isArray(v) ? (v[0] || '') : (v || '');
          usuario = {
            login:        str(obj.sAMAccountName),
            nome:         str(obj.displayName) || str(obj.sAMAccountName),
            email:        str(obj.mail),
            departamento: str(obj.department)
          };
        });

        res.on('error', (err) => {
          client.destroy();
          reject(err);
        });

        res.on('end', () => {
          client.destroy();
          resolve(usuario);
        });
      });
    });
  });
}

module.exports = {
  lerConfigAD,
  configValida,
  autenticarUsuario,
  testarConexao,
  listarUsuariosAD,
  buscarUsuarioAD
};
