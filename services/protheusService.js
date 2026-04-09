const { registrarLog } = require('./logService');

const DEFAULT_TIMEOUT_MS = Math.max(3000, parseInt(process.env.PROTHEUS_TIMEOUT_MS || '10000', 10) || 10000);
const DEFAULT_EXPLORER_API = process.env.PROTHEUS_EXPLORER_API || 'http://127.0.0.1:3201/api';

async function carregarConfigProtheus(pool) {
  try {
    const resultado = await pool.request()
      .input('grupo', 'protheus')
      .query('SELECT chave, valor FROM configuracoes WHERE grupo = @grupo');

    const config = {};
    resultado.recordset.forEach((row) => {
      config[row.chave] = row.valor;
    });
    return config;
  } catch {
    return {};
  }
}

function boolValue(config, key, fallback = false) {
  if (!Object.prototype.hasOwnProperty.call(config, key)) return !!fallback;
  return String(config[key]) === 'true';
}

function normalizarBaseURL(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function normalizarPath(pathRel) {
  const raw = String(pathRel || '').trim();
  if (!raw) return '/health';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizarExplorerBase(url) {
  const raw = String(url || '').trim();
  if (!raw) return DEFAULT_EXPLORER_API;
  return raw.replace(/\/+$/, '');
}

function escapeSqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function textoLimpo(value) {
  return String(value || '').trim();
}

function padCodigo(value, size = 6) {
  return textoLimpo(value).padStart(size, '0');
}

function montarLabelCodigoNome(codigo, nome, extras = '') {
  const cod = textoLimpo(codigo);
  const desc = textoLimpo(nome || extras);
  if (cod && desc) return `${cod} - ${desc}`;
  return cod || desc;
}

function montarHeaders(config) {
  const headers = {
    Accept: 'application/json',
  };

  const authTipo = (config.protheus_auth_tipo || 'basic').trim().toLowerCase();
  const usuario = String(config.protheus_usuario || '').trim();
  const senha = String(config.protheus_senha || '').trim();
  const headerNome = String(config.protheus_api_header || 'x-api-key').trim() || 'x-api-key';

  if (authTipo === 'basic' && usuario) {
    headers.Authorization = `Basic ${Buffer.from(`${usuario}:${senha}`).toString('base64')}`;
  } else if ((authTipo === 'apikey' || authTipo === 'bearer') && senha) {
    if (authTipo === 'bearer') {
      headers.Authorization = `Bearer ${senha}`;
    } else {
      headers[headerNome] = senha;
    }
  }

  if (usuario) headers['x-portal-usuario'] = usuario;
  if (config.protheus_empresa) headers['x-portal-empresa'] = String(config.protheus_empresa).trim();
  if (config.protheus_filial) headers['x-portal-filial'] = String(config.protheus_filial).trim();
  if (config.protheus_ambiente) headers['x-portal-ambiente'] = String(config.protheus_ambiente).trim();

  return headers;
}

function montarConfigEfetiva(config, overrides = {}) {
  const efetiva = { ...config };
  Object.entries(overrides || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      efetiva[key] = value;
    }
  });

  return {
    ...efetiva,
    protheus_ativo: String(
      overrides.protheus_ativo !== undefined
        ? overrides.protheus_ativo
        : boolValue(config, 'protheus_ativo', false)
    ),
    protheus_logs_ativo: String(
      overrides.protheus_logs_ativo !== undefined
        ? overrides.protheus_logs_ativo
        : boolValue(config, 'protheus_logs_ativo', true)
    ),
    protheus_manual: String(
      overrides.protheus_manual !== undefined
        ? overrides.protheus_manual
        : boolValue(config, 'protheus_manual', true)
    ),
  };
}

async function registrarLogProtheus(pool, { usuario, ip, acao, detalhe }) {
  return registrarLog(pool, {
    usuario: usuario || 'sistema',
    ip,
    acao: acao || 'PROTHEUS',
    sistema: 'portal',
    detalhes: detalhe || 'Integracao Protheus',
  });
}

async function obterConfigIntegracaoProtheus(pool) {
  const config = await carregarConfigProtheus(pool);
  const timeoutConfigurado = parseInt(config.protheus_timeout_ms || DEFAULT_TIMEOUT_MS, 10);

  return {
    config,
    ativo: boolValue(config, 'protheus_ativo', false),
    registrarLogs: boolValue(config, 'protheus_logs_ativo', true),
    manual: boolValue(config, 'protheus_manual', true),
    url: normalizarBaseURL(config.protheus_url),
    authTipo: String(config.protheus_auth_tipo || 'basic').trim().toLowerCase(),
    healthPath: normalizarPath(config.protheus_health_path || '/health'),
    timeoutMs: Math.max(3000, Number.isFinite(timeoutConfigurado) ? timeoutConfigurado : DEFAULT_TIMEOUT_MS),
    ambiente: String(config.protheus_ambiente || '').trim(),
    empresa: String(config.protheus_empresa || '').trim(),
    filial: String(config.protheus_filial || '').trim(),
    explorerApi: normalizarExplorerBase(config.protheus_explorer_api || DEFAULT_EXPLORER_API),
  };
}

async function executarQueryExplorer(pool, query) {
  const { explorerApi, timeoutMs } = await obterConfigIntegracaoProtheus(pool);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL('query', `${explorerApi}/`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const texto = await response.text().catch(() => '');
      throw new Error(texto || `Explorer HTTP ${response.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.value)) return data.value;
    return [];
  } catch (erro) {
    clearTimeout(timeoutId);
    throw erro;
  }
}

async function listarColunasProtheus(pool, tabela = 'SN1010') {
  const tabelaSegura = String(tabela || 'SN1010').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  return executarQueryExplorer(pool, `
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${escapeSqlLiteral(tabelaSegura)}'
    ORDER BY ORDINAL_POSITION
  `);
}

async function listarDistintosProtheus(pool, tabela, coluna, limite = 50) {
  const tabelaSegura = String(tabela || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const colunaSegura = String(coluna || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const top = Math.max(1, Math.min(parseInt(limite, 10) || 50, 200));

  if (!tabelaSegura || !colunaSegura) return [];

  return executarQueryExplorer(pool, `
    SELECT TOP ${top} LTRIM(RTRIM(${colunaSegura})) AS valor
    FROM ${tabelaSegura}
    WHERE ISNULL(${colunaSegura}, '') <> ''
      AND ISNULL(D_E_L_E_T_, '') <> '*'
    GROUP BY ${colunaSegura}
    ORDER BY valor
  `);
}

async function listarOpcoesPatrimonioProtheus(pool, filtros = {}) {
  const tabela = String(filtros.tabela || 'SN1010').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const filialCampo = String(filtros.campoFilial || 'N1_FILIAL').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const localCampo = String(filtros.campoLocal || 'N1_LOCAL').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const statusCampo = String(filtros.campoStatus || 'N1_STATUS').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const fornecCampo = String(filtros.campoFornecedor || 'N1_FORNEC').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const lojaCampo = String(filtros.campoLoja || 'N1_LOJA').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const notaCampo = String(filtros.campoNota || 'N1_NFISCAL').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const [filiaisMeta, cadastroEmpresasFiliais, locaisMeta, locaisCadastroMeta, status, fornecedores, notas, motivos] = await Promise.all([
    executarQueryExplorer(pool, `
      SELECT DISTINCT
        LTRIM(RTRIM(b.${filialCampo})) AS filial,
        LTRIM(RTRIM(sc.M0_CODIGO)) AS empresa,
        LTRIM(RTRIM(sc.M0_NOME)) AS empresa_nome,
        LTRIM(RTRIM(COALESCE(NULLIF(sc.M0_FILIAL, ''), NULLIF(sc.M0_NOMECOM, ''), sc.M0_NOME))) AS filial_nome
      FROM ${tabela} b
      OUTER APPLY (
        SELECT TOP 1 M0_CODIGO, M0_NOME, M0_FILIAL, M0_NOMECOM
        FROM SYS_COMPANY sc
        WHERE ISNULL(sc.D_E_L_E_T_, '') <> '*'
          AND LTRIM(RTRIM(sc.M0_CODFIL)) = LTRIM(RTRIM(b.${filialCampo}))
        ORDER BY sc.R_E_C_N_O_
      ) sc
      WHERE ISNULL(b.D_E_L_E_T_, '') <> '*'
        AND ISNULL(b.${filialCampo}, '') <> ''
      ORDER BY empresa, filial
    `),
    executarQueryExplorer(pool, `
      SELECT DISTINCT
        LTRIM(RTRIM(sc.M0_CODIGO)) AS empresa,
        LTRIM(RTRIM(sc.M0_NOME)) AS empresa_nome,
        LTRIM(RTRIM(sc.M0_CODFIL)) AS filial,
        LTRIM(RTRIM(COALESCE(NULLIF(sc.M0_FILIAL, ''), NULLIF(sc.M0_NOMECOM, ''), sc.M0_NOME))) AS filial_nome
      FROM SYS_COMPANY sc
      WHERE ISNULL(sc.D_E_L_E_T_, '') <> '*'
        AND ISNULL(sc.M0_CODIGO, '') <> ''
        AND ISNULL(sc.M0_CODFIL, '') <> ''
      ORDER BY empresa, filial
    `),
    executarQueryExplorer(pool, `
      SELECT DISTINCT
        RIGHT('000000' + LTRIM(RTRIM(b.${localCampo})), 6) AS codigo,
        LTRIM(RTRIM(n.NNR_DESCRI)) AS nome,
        LTRIM(RTRIM(b.${filialCampo})) AS filial
      FROM ${tabela} b
      LEFT JOIN NNR010 n
        ON LTRIM(RTRIM(n.NNR_FILIAL)) = LTRIM(RTRIM(b.${filialCampo}))
       AND RIGHT('000000' + LTRIM(RTRIM(n.NNR_CODIGO)), 6) = RIGHT('000000' + LTRIM(RTRIM(b.${localCampo})), 6)
       AND ISNULL(n.D_E_L_E_T_, '') <> '*'
      WHERE ISNULL(b.D_E_L_E_T_, '') <> '*'
        AND ISNULL(b.${localCampo}, '') <> ''
      ORDER BY codigo
    `),
    executarQueryExplorer(pool, `
      SELECT DISTINCT
        RIGHT('000000' + LTRIM(RTRIM(n.NNR_CODIGO)), 6) AS codigo,
        LTRIM(RTRIM(n.NNR_DESCRI)) AS nome,
        LTRIM(RTRIM(n.NNR_FILIAL)) AS filial
      FROM NNR010 n
      WHERE ISNULL(n.D_E_L_E_T_, '') <> '*'
        AND ISNULL(n.NNR_CODIGO, '') <> ''
      ORDER BY filial, codigo
    `),
    listarDistintosProtheus(pool, tabela, statusCampo, 50),
    executarQueryExplorer(pool, `
      SELECT TOP 200
        LTRIM(RTRIM(b.${fornecCampo})) AS codigo,
        LTRIM(RTRIM(b.${lojaCampo})) AS loja,
        LTRIM(RTRIM(a.A2_NOME)) AS nome
      FROM ${tabela} b
      LEFT JOIN SA2010 a
        ON a.A2_COD = b.${fornecCampo}
       AND a.A2_LOJA = b.${lojaCampo}
       AND ISNULL(a.D_E_L_E_T_, '') <> '*'
      WHERE ISNULL(b.D_E_L_E_T_, '') <> '*'
        AND ISNULL(b.${fornecCampo}, '') <> ''
      GROUP BY b.${fornecCampo}, b.${lojaCampo}, a.A2_NOME
      ORDER BY nome, codigo
    `),
    listarDistintosProtheus(pool, tabela, notaCampo, 200),
    executarQueryExplorer(pool, `
      SELECT DISTINCT LTRIM(RTRIM(FN6_MOTIVO)) AS valor
      FROM FN6010
      WHERE ISNULL(D_E_L_E_T_, '') <> '*'
        AND ISNULL(FN6_MOTIVO, '') <> ''
      ORDER BY valor
    `),
  ]);

  const empresasMap = new Map();
  const filiais = [];
  const filiaisSeen = new Set();
  const cadastroEmpresasMap = new Map();
  const cadastroFiliais = [];
  const cadastroFiliaisSeen = new Set();

  filiaisMeta.forEach((row) => {
    const empresa = textoLimpo(row.empresa);
    const filial = textoLimpo(row.filial);
    const empresaNome = textoLimpo(row.empresa_nome || row.filial_nome);
    const filialNome = textoLimpo(row.filial_nome || row.empresa_nome);

    if (empresa) {
      const atual = empresasMap.get(empresa) || { nomes: new Set() };
      if (empresaNome) atual.nomes.add(empresaNome);
      empresasMap.set(empresa, atual);
    }

    if (filial && !filiaisSeen.has(filial)) {
      filiaisSeen.add(filial);
      filiais.push({
        value: filial,
        label: montarLabelCodigoNome(filial, filialNome || empresaNome),
        nome: filialNome || empresaNome,
      });
    }
  });

  const empresas = Array.from(empresasMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
    .map(([codigo, info]) => {
      const nomes = Array.from(info.nomes || []);
      const principal = nomes[0] || '';
      const sufixo = nomes.length > 1 ? ` (+${nomes.length - 1})` : '';
      return {
        value: codigo,
        label: principal ? `${codigo} - ${principal}${sufixo}` : codigo,
        nome: principal,
      };
    });

  cadastroEmpresasFiliais.forEach((row) => {
    const empresa = textoLimpo(row.empresa);
    const filial = textoLimpo(row.filial);
    const empresaNome = textoLimpo(row.empresa_nome || row.filial_nome);
    const filialNome = textoLimpo(row.filial_nome || row.empresa_nome);

    if (empresa) {
      const atual = cadastroEmpresasMap.get(empresa) || { nomes: new Set() };
      if (empresaNome) atual.nomes.add(empresaNome);
      cadastroEmpresasMap.set(empresa, atual);
    }

    if (filial && !cadastroFiliaisSeen.has(filial)) {
      cadastroFiliaisSeen.add(filial);
      cadastroFiliais.push({
        value: filial,
        label: montarLabelCodigoNome(filial, filialNome || empresaNome),
        nome: filialNome || empresaNome,
        empresa,
      });
    }
  });

  const empresasCadastro = Array.from(cadastroEmpresasMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
    .map(([codigo, info]) => {
      const nomes = Array.from(info.nomes || []);
      const principal = nomes[0] || '';
      const sufixo = nomes.length > 1 ? ` (+${nomes.length - 1})` : '';
      return {
        value: codigo,
        label: principal ? `${codigo} - ${principal}${sufixo}` : codigo,
        nome: principal,
      };
    });

  const locaisMap = new Map();
  locaisMeta.forEach((row) => {
    const codigo = padCodigo(row.codigo, 6);
    const nome = textoLimpo(row.nome);
    if (!codigo || locaisMap.has(codigo)) return;
    locaisMap.set(codigo, {
      value: codigo,
      label: montarLabelCodigoNome(codigo, nome),
      nome,
    });
  });

  const locaisCadastroMap = new Map();
  locaisCadastroMeta.forEach((row) => {
    const codigo = padCodigo(row.codigo, 6);
    const nome = textoLimpo(row.nome);
    const filial = textoLimpo(row.filial);
    const chave = `${filial}::${codigo}`;
    if (!codigo || locaisCadastroMap.has(chave)) return;
    locaisCadastroMap.set(chave, {
      value: codigo,
      label: montarLabelCodigoNome(codigo, nome),
      nome,
      filial,
    });
  });

  return {
    empresas,
    filiais,
    locais: Array.from(locaisMap.values()).sort((a, b) => a.value.localeCompare(b.value, 'pt-BR')),
    empresasCadastro,
    filiaisCadastro: cadastroFiliais.sort((a, b) => a.value.localeCompare(b.value, 'pt-BR')),
    locaisCadastro: Array.from(locaisCadastroMap.values()).sort((a, b) => a.value.localeCompare(b.value, 'pt-BR')),
    status: status.map((x) => x.valor).filter(Boolean),
    statusBemCadastro: status
      .map((x) => ({ value: textoLimpo(x.valor), label: textoLimpo(x.valor) }))
      .filter((x) => x.value),
    motivosCadastro: motivos
      .map((x) => ({ value: textoLimpo(x.valor), label: textoLimpo(x.valor) }))
      .filter((x) => x.value),
    fornecedores: fornecedores
      .map((x) => ({
        codigo: (x.codigo || '').trim(),
        loja: (x.loja || '').trim(),
        nome: (x.nome || '').trim(),
      }))
      .filter((x) => x.codigo),
    notas: notas.map((x) => x.valor).filter(Boolean),
  };
}

async function buscarAtivosProtheus(pool, filtros = {}) {
  const tabela = String(filtros.tabela || 'SN1010').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const top = Math.max(1, Math.min(parseInt(filtros.limite, 10) || 50, 200));
  const mapeamento = {
    filial: String(filtros.campoFilial || 'N1_FILIAL').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    codigo: String(filtros.campoCodigo || 'N1_CBASE').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    descricao: String(filtros.campoDescricao || 'N1_DESCRIC').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    fornecedor: String(filtros.campoFornecedor || 'N1_FORNEC').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    local: String(filtros.campoLocal || 'N1_LOCAL').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    serie: String(filtros.campoSerie || 'N1_NSERIE').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    nota: String(filtros.campoNota || 'N1_NFISCAL').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    status: String(filtros.campoStatus || 'N1_STATUS').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    barra: String(filtros.campoBarra || 'N1_CODBAR').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
  };

  const campoBuscaAlias = String(filtros.campoBusca || 'codigo').trim().toLowerCase();
  const campoBusca = mapeamento[campoBuscaAlias] || mapeamento.codigo;
  const busca = String(filtros.q || '').trim();
  const empresa = String(filtros.empresa || '').trim();
  const filial = String(filtros.filial || '').trim();
  const status = String(filtros.status || '').trim();
  const fornecedor = String(filtros.fornecedor || '').trim();
  const nota = String(filtros.nota || '').trim();
  const local = String(filtros.local || '').trim();
  const where = [`ISNULL(b.D_E_L_E_T_, '') <> '*'`];

  if (busca) where.push(`${campoBusca} LIKE '%${escapeSqlLiteral(busca)}%'`);
  if (empresa) {
    where.push(`EXISTS (
      SELECT 1
      FROM SYS_COMPANY scf
      WHERE ISNULL(scf.D_E_L_E_T_, '') <> '*'
        AND LTRIM(RTRIM(scf.M0_CODFIL)) = LTRIM(RTRIM(b.${mapeamento.filial}))
        AND LTRIM(RTRIM(scf.M0_CODIGO)) = '${escapeSqlLiteral(empresa)}'
    )`);
  }
  if (filial) where.push(`${mapeamento.filial} = '${escapeSqlLiteral(filial)}'`);
  if (status) where.push(`${mapeamento.status} = '${escapeSqlLiteral(status)}'`);
  if (fornecedor) where.push(`${mapeamento.fornecedor} = '${escapeSqlLiteral(fornecedor)}'`);
  if (nota) where.push(`${mapeamento.nota} = '${escapeSqlLiteral(nota)}'`);
  if (local) where.push(`${mapeamento.local} = '${escapeSqlLiteral(local)}'`);

  const query = `
    SELECT TOP ${top}
      LTRIM(RTRIM(${mapeamento.filial})) AS filial,
      LTRIM(RTRIM(sc.M0_CODIGO)) AS empresa,
      LTRIM(RTRIM(sc.M0_NOME)) AS empresa_nome,
      LTRIM(RTRIM(COALESCE(NULLIF(sc.M0_FILIAL, ''), NULLIF(sc.M0_NOMECOM, ''), sc.M0_NOME))) AS filial_nome,
      LTRIM(RTRIM(${mapeamento.codigo})) AS codigo,
      LTRIM(RTRIM(${mapeamento.descricao})) AS descricao,
      LTRIM(RTRIM(${mapeamento.fornecedor})) AS fornecedor,
      RIGHT('000000' + LTRIM(RTRIM(${mapeamento.local})), 6) AS local,
      LTRIM(RTRIM(loc.NNR_DESCRI)) AS local_nome,
      LTRIM(RTRIM(${mapeamento.serie})) AS num_serie,
      LTRIM(RTRIM(${mapeamento.nota})) AS nota_fiscal,
      LTRIM(RTRIM(${mapeamento.status})) AS status,
      LTRIM(RTRIM(${mapeamento.barra})) AS codigo_barras,
      b.D_E_L_E_T_ AS deletado
    FROM ${tabela} b
    OUTER APPLY (
      SELECT TOP 1 M0_CODIGO, M0_NOME, M0_FILIAL, M0_NOMECOM
      FROM SYS_COMPANY sc
      WHERE ISNULL(sc.D_E_L_E_T_, '') <> '*'
        AND LTRIM(RTRIM(sc.M0_CODFIL)) = LTRIM(RTRIM(b.${mapeamento.filial}))
      ORDER BY sc.R_E_C_N_O_
    ) sc
    LEFT JOIN NNR010 loc
      ON LTRIM(RTRIM(loc.NNR_FILIAL)) = LTRIM(RTRIM(b.${mapeamento.filial}))
     AND RIGHT('000000' + LTRIM(RTRIM(loc.NNR_CODIGO)), 6) = RIGHT('000000' + LTRIM(RTRIM(b.${mapeamento.local})), 6)
     AND ISNULL(loc.D_E_L_E_T_, '') <> '*'
    WHERE ${where.join(' AND ')}
    ORDER BY ${mapeamento.codigo} DESC
  `;

  return {
    tabela,
    mapeamento,
    rows: await executarQueryExplorer(pool, query),
  };
}

async function testarConexaoProtheus(pool, overrides = {}) {
  const configBanco = await carregarConfigProtheus(pool);
  const config = montarConfigEfetiva(configBanco, overrides);
  const url = normalizarBaseURL(config.protheus_url);
  const healthPath = normalizarPath(config.protheus_health_path || '/health');
  const timeoutConfigurado = parseInt(config.protheus_timeout_ms || DEFAULT_TIMEOUT_MS, 10);
  const timeoutMs = Math.max(3000, Number.isFinite(timeoutConfigurado) ? timeoutConfigurado : DEFAULT_TIMEOUT_MS);
  const usuarioLog = overrides.usuarioLog || 'sistema';
  const ip = overrides.ip || null;
  const registrarLogs = String(config.protheus_logs_ativo) === 'true';

  if (!url) {
    if (registrarLogs) {
      await registrarLogProtheus(pool, {
        usuario: usuarioLog,
        ip,
        acao: 'PROTHEUS_TESTE',
        detalhe: 'Teste de conexao falhou: URL do Protheus nao informada.',
      });
    }
    return { ok: false, erro: 'Informe a URL do serviço Protheus.' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL(healthPath, `${url}/`), {
      method: 'GET',
      headers: montarHeaders(config),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    let detalhe = '';
    try {
      detalhe = await response.text();
    } catch {
      detalhe = '';
    }

    if (!response.ok) {
      if (registrarLogs) {
        await registrarLogProtheus(pool, {
          usuario: usuarioLog,
          ip,
          acao: 'PROTHEUS_TESTE',
          detalhe: `Teste de conexao falhou: HTTP ${response.status}${detalhe ? ` - ${detalhe.slice(0, 220)}` : ''}`,
        });
      }
      return {
        ok: false,
        erro: `Protheus respondeu com status ${response.status}.`,
        detalhe: detalhe.slice(0, 500),
      };
    }

    if (registrarLogs) {
      await registrarLogProtheus(pool, {
        usuario: usuarioLog,
        ip,
        acao: 'PROTHEUS_TESTE',
        detalhe: `Teste de conexao realizado com sucesso em ${url}${healthPath}`,
      });
    }

    return {
      ok: true,
      mensagem: 'Conexao com Protheus validada com sucesso.',
      detalhe: detalhe.slice(0, 500),
    };
  } catch (erro) {
    clearTimeout(timeoutId);
    const detalheErro = erro.name === 'AbortError'
      ? `Tempo limite excedido (${timeoutMs}ms).`
      : erro.message;

    if (registrarLogs) {
      await registrarLogProtheus(pool, {
        usuario: usuarioLog,
        ip,
        acao: 'PROTHEUS_TESTE',
        detalhe: `Teste de conexao falhou: ${detalheErro}`,
      });
    }

    return {
      ok: false,
      erro: 'Nao foi possivel conectar ao Protheus.',
      detalhe: detalheErro,
    };
  }
}

module.exports = {
  carregarConfigProtheus,
  executarQueryExplorer,
  listarColunasProtheus,
  listarDistintosProtheus,
  listarOpcoesPatrimonioProtheus,
  buscarAtivosProtheus,
  obterConfigIntegracaoProtheus,
  registrarLogProtheus,
  testarConexaoProtheus,
};
