/* ================================================================
 * Leitor de Extrato OFX - Processamento 100% no navegador
 * ================================================================ */

// Estado global
const state = {
  transactions: [],
  filtered: [],
  accountInfo: {},
  chart: null,
  currentPage: 1,
  pageSize: 100,
  counterpartyList: [],
  selectedIds: new Set(),   // FITIDs selecionados (checkboxes)
};

// ============================================================
// CALCULADORA DE PORCENTAGEM
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const calcValue = document.getElementById('calc-value');
  const calcOp = document.getElementById('calc-op');
  const calcPercent = document.getElementById('calc-percent');
  const calcResult = document.getElementById('calc-result');
  const calcSecondLabel = document.getElementById('calc-second-label');
  const calcHint = document.getElementById('calc-hint');
  if (!calcValue) return;

  const hints = {
    of: 'Ex.: 10% de R$ 10.000,00 = R$ 1.000,00',
    add: 'Ex.: R$ 10.000,00 + 10% de acréscimo = R$ 11.000,00',
    sub: 'Ex.: R$ 10.000,00 - 10% de desconto = R$ 9.000,00',
    ratio: 'Ex.: R$ 200,00 representa 20% de R$ 1.000,00',
  };

  const labels = {
    of: 'Porcentagem (%)',
    add: 'Porcentagem (%)',
    sub: 'Porcentagem (%)',
    ratio: 'É % de qual valor (R$)',
  };

  function calc() {
    const v = parseBRNumber(calcValue.value);
    const p = parseBRNumber(calcPercent.value);
    const op = calcOp.value;

    calcSecondLabel.textContent = labels[op];
    calcHint.textContent = hints[op];

    if (v === null || p === null) {
      calcResult.textContent = op === 'ratio' ? '0,00%' : formatCurrency(0);
      return;
    }

    let result, display;
    switch (op) {
      case 'of':
        result = (v * p) / 100;
        display = formatCurrency(result);
        break;
      case 'add':
        result = v * (1 + p / 100);
        display = formatCurrency(result);
        break;
      case 'sub':
        result = v * (1 - p / 100);
        display = formatCurrency(result);
        break;
      case 'ratio':
        if (p === 0) {
          display = '—';
        } else {
          result = (v / p) * 100;
          display = result.toFixed(2).replace('.', ',') + '%';
        }
        break;
    }
    calcResult.textContent = display;
  }

  // Formata o campo de valor ao perder o foco (blur)
  function formatCurrencyInput(input) {
    const raw = parseBRNumber(input.value);
    if (raw === null) {
      input.value = '';
      return;
    }
    // Formatação brasileira sem símbolo R$: 10.000,00
    input.value = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(raw);
  }

  calcValue.addEventListener('blur', () => {
    formatCurrencyInput(calcValue);
    calc();
  });
  calcValue.addEventListener('input', calc);
  calcPercent.addEventListener('input', calc);
  calcOp.addEventListener('change', calc);

  // Toggle do painel de contrapartes
  const cpToggle = document.getElementById('counterparty-toggle');
  const cpPanel = document.getElementById('counterparty-panel');
  if (cpToggle && cpPanel) {
    cpToggle.addEventListener('click', () => {
      const isHidden = cpPanel.classList.toggle('hidden');
      cpToggle.innerHTML = isHidden
        ? '<i class="fas fa-chevron-down"></i><span class="ml-1">Expandir</span>'
        : '<i class="fas fa-chevron-up"></i><span class="ml-1">Recolher</span>';
    });
  }
});

// ============================================================
// PARSER OFX
// ============================================================
/**
 * OFX pode vir em dois formatos:
 *  - SGML (versões 1.x): tags sem fechamento, ex: <NAME>João
 *  - XML  (versões 2.x): tags com fechamento, ex: <NAME>João</NAME>
 * Este parser trata ambos os casos.
 */
function parseOFX(content) {
  // Remove cabeçalho OFX (linhas antes de <OFX>)
  const ofxStart = content.indexOf('<OFX>');
  if (ofxStart === -1) {
    throw new Error('Arquivo OFX inválido: tag <OFX> não encontrada.');
  }
  let body = content.substring(ofxStart);

  // Normaliza tags SGML para XML: <TAG>valor -> <TAG>valor</TAG>
  // Aplica somente quando não existe já o fechamento na linha
  body = body.replace(
    /<([A-Z0-9._]+)>([^<\r\n]+)(?!<\/\1>)/g,
    (match, tag, value) => {
      // Se já é uma tag de fechamento ou vazia, mantém
      if (value.trim() === '') return match;
      return `<${tag}>${value.trim()}</${tag}>`;
    }
  );

  // Extrai informações da conta
  const accountInfo = {
    bankId: getTagValue(body, 'BANKID'),
    branchId: getTagValue(body, 'BRANCHID'),
    accountId: getTagValue(body, 'ACCTID'),
    accountType: getTagValue(body, 'ACCTTYPE'),
    currency: getTagValue(body, 'CURDEF') || 'BRL',
    startDate: parseOFXDate(getTagValue(body, 'DTSTART')),
    endDate: parseOFXDate(getTagValue(body, 'DTEND')),
    balance: parseFloat(getTagValue(body, 'BALAMT') || '0'),
    balanceDate: parseOFXDate(getTagValue(body, 'DTASOF')),
  };

  // Extrai transações (STMTTRN)
  const transactions = [];
  const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
  let match;
  let idx = 0;
  while ((match = trnRegex.exec(body)) !== null) {
    const block = match[1];
    const trnType = getTagValue(block, 'TRNTYPE') || 'OTHER';
    const dtPosted = parseOFXDate(getTagValue(block, 'DTPOSTED'));
    const amount = parseFloat(getTagValue(block, 'TRNAMT') || '0');
    const fitId = getTagValue(block, 'FITID') || '';
    const checkNum = getTagValue(block, 'CHECKNUM') || '';
    const refNum = getTagValue(block, 'REFNUM') || '';
    let memo = getTagValue(block, 'MEMO') || '';
    let name = getTagValue(block, 'NAME') || '';

    // Conta de origem/destino (BANKACCTTO / CCACCTTO no padrão OFX)
    const counterparty = extractCounterparty(block, memo, name);

    // Detecção de estorno/devolução:
    //  - Tag CORRECTFITID presente = corrige transação anterior
    //  - CORRECTACTION = REPLACE/DELETE
    //  - TRNTYPE = REVERSAL (extensão de alguns bancos)
    //  - Palavras-chave no MEMO/NAME (padrão brasileiro)
    const correctFitId = getTagValue(block, 'CORRECTFITID');
    const correctAction = getTagValue(block, 'CORRECTACTION');
    const isReversal = detectReversal(trnType, memo, name, correctFitId, correctAction);

    // Descrição consolidada
    let description = name || memo;
    if (name && memo && name !== memo) {
      description = `${name} - ${memo}`;
    }
    if (!description) description = trnType;

    transactions.push({
      id: fitId || `trn-${idx++}`,
      date: dtPosted,
      type: amount >= 0 ? 'credit' : 'debit',
      trnType: trnType,
      description: description.trim(),
      memo: memo.trim(),
      name: name.trim(),
      document: checkNum || refNum || fitId,
      amount: amount,
      absAmount: Math.abs(amount),
      counterparty: counterparty.label,
      counterpartyAccount: counterparty.account,
      counterpartyBank: counterparty.bank,
      counterpartyBranch: counterparty.branch,
      counterpartyName: counterparty.name,
      isReversal,                              // boolean: é estorno/devolução?
      reversalReason: isReversal ? detectReversalReason(memo, name, correctFitId) : '',
      correctFitId,                            // FITID da transação sendo corrigida
    });
  }

  if (transactions.length === 0) {
    throw new Error(
      'Nenhuma transação encontrada no arquivo. Verifique se o OFX está no formato correto.'
    );
  }

  // Calcula saldo antes/após cada transação em ordem cronológica.
  // O ponto de referência é o saldo final (BALAMT/DTASOF) informado no OFX.
  // Trabalhamos "de trás para frente" a partir desse saldo.
  computeBalanceEvolution(transactions, accountInfo);

  return { accountInfo, transactions };
}

/**
 * Preenche balanceBefore e balanceAfter em cada transação.
 *
 * Estratégia:
 *  1. Ordena por data (ascendente); transações sem data ficam por último.
 *  2. Usa o saldo final (accountInfo.balance) como âncora.
 *  3. Percorre de trás para frente: balanceAfter da última transação = saldo final;
 *     balanceBefore = balanceAfter - amount.
 *  4. Cada transação anterior tem balanceAfter = balanceBefore da seguinte.
 *
 * Assim, a soma acumulada bate exatamente com o saldo do extrato.
 */
function computeBalanceEvolution(transactions, accountInfo) {
  const dated = transactions.filter((t) => t.date);
  const undated = transactions.filter((t) => !t.date);

  // Ordena cronologicamente (ascendente)
  dated.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Se não temos saldo final, tenta usar 0 (a evolução será relativa)
  let anchor = typeof accountInfo.balance === 'number' && !isNaN(accountInfo.balance)
    ? accountInfo.balance
    : 0;

  // Percorre de trás para frente
  let currentAfter = anchor;
  for (let i = dated.length - 1; i >= 0; i--) {
    const t = dated[i];
    t.balanceAfter = currentAfter;
    t.balanceBefore = currentAfter - t.amount;
    currentAfter = t.balanceBefore;
  }
  // Transações sem data: marcamos como null (não é possível saber a ordem)
  undated.forEach((t) => {
    t.balanceBefore = null;
    t.balanceAfter = null;
  });
}

function getTagValue(text, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)<\/${tag}>`, 'i');
  const m = text.match(regex);
  return m ? m[1].trim() : '';
}

/**
 * Detecta se uma transação é estorno/devolução.
 * Verifica:
 *  1. Tags CORRECTFITID / CORRECTACTION (padrão OFX)
 *  2. TRNTYPE=REVERSAL (extensão)
 *  3. Palavras-chave em MEMO/NAME
 */
function detectReversal(trnType, memo, name, correctFitId, correctAction) {
  if (correctFitId && correctFitId.length > 0) return true;
  if (correctAction === 'REPLACE' || correctAction === 'DELETE') return true;
  if (trnType && trnType.toUpperCase() === 'REVERSAL') return true;
  const text = normalizeText(`${memo} ${name}`);
  // Palavras-chave (sem acento, minúsculo)
  const keywords = [
    'estorno',
    'estornado',
    'estornada',
    'devolucao',
    'devolvido',
    'devolvida',
    'reembolso',
    'reembolsado',
    'cancelamento',
    'cancelado',
    'cancelada',
    'chargeback',
    'reversal',
    'reversao',
    'ressarcimento',
  ];
  return keywords.some((kw) => text.includes(kw));
}

function detectReversalReason(memo, name, correctFitId) {
  if (correctFitId) return `Corrige transação ${correctFitId}`;
  const text = `${memo} ${name}`.toUpperCase();
  const patterns = [
    { re: /ESTORNO/, reason: 'Estorno' },
    { re: /DEVOLU[ÇC][ÃA]O|DEVOLVID[OA]/, reason: 'Devolução' },
    { re: /REEMBOLSO|REEMBOLSAD[OA]/, reason: 'Reembolso' },
    { re: /CANCELAMENTO|CANCELAD[OA]/, reason: 'Cancelamento' },
    { re: /CHARGEBACK/, reason: 'Chargeback' },
    { re: /RESSARCIMENTO/, reason: 'Ressarcimento' },
    { re: /REVERS[AÃ]O|REVERSAL/, reason: 'Reversão' },
  ];
  for (const p of patterns) if (p.re.test(text)) return p.reason;
  return 'Estorno';
}

function getBlockValue(text, blockTag) {
  const regex = new RegExp(`<${blockTag}>([\\s\\S]*?)<\/${blockTag}>`, 'i');
  const m = text.match(regex);
  return m ? m[1] : '';
}

/**
 * Extrai a conta contraparte (destino em débito, origem em crédito).
 *
 * Fontes possíveis, em ordem de prioridade:
 *  1. <BANKACCTTO> / <CCACCTTO> - blocos estruturados do padrão OFX
 *  2. <PAYEEID> ou bloco <PAYEE> - dados do beneficiário
 *  3. Heurística sobre MEMO/NAME - bancos brasileiros costumam colocar
 *     dados como "AG 1234 CC 56789-0" ou "CPF/CNPJ ***.***.***-**"
 */
function extractCounterparty(block, memo, name) {
  const result = { label: '', account: '', bank: '', branch: '', name: '' };

  // 1. BANKACCTTO estruturado
  const bankAcctTo = getBlockValue(block, 'BANKACCTTO');
  if (bankAcctTo) {
    result.bank = getTagValue(bankAcctTo, 'BANKID');
    result.branch = getTagValue(bankAcctTo, 'BRANCHID');
    result.account = getTagValue(bankAcctTo, 'ACCTID');
  }
  // Cartão de crédito destino
  const ccAcctTo = getBlockValue(block, 'CCACCTTO');
  if (ccAcctTo && !result.account) {
    result.account = getTagValue(ccAcctTo, 'ACCTID');
  }

  // 2. Bloco PAYEE (beneficiário)
  const payeeBlock = getBlockValue(block, 'PAYEE');
  if (payeeBlock) {
    result.name = getTagValue(payeeBlock, 'NAME') || result.name;
  }
  const payeeId = getTagValue(block, 'PAYEEID');
  if (payeeId && !result.name) result.name = payeeId;

  // 3. Heurística no MEMO / NAME (padrão brasileiro)
  const source = `${memo} ${name}`;
  if (!result.branch) {
    const agMatch = source.match(/\bAG[.\s]*(\d{3,5})/i);
    if (agMatch) result.branch = agMatch[1];
  }
  if (!result.account) {
    const ccMatch = source.match(/\b(?:CC|C\/C|CONTA)[.\s]*([\d]{3,}[-.]?[\dxX]?)/i);
    if (ccMatch) result.account = ccMatch[1];
  }
  if (!result.bank) {
    const bcoMatch = source.match(/\b(?:BCO|BANCO)[.\s]*(\d{3})/i);
    if (bcoMatch) result.bank = bcoMatch[1];
  }

  // 4. Nome extraído do memo: pega palavras após verbos comuns de transferência
  if (!result.name) {
    const nameMatch = source.match(
      /(?:PIX|TED|DOC|TRANSF(?:ERENCIA)?|PAGAMENTO|PAGTO)\s+(?:ENVIADO|ENVIADA|RECEBIDO|RECEBIDA|CRED|DEB|PARA|A|DE)?\s*([A-ZÀ-Ú][A-ZÀ-Ú\s.]{2,60}?)(?:\s+(?:AG|CC|BCO|BANCO|CPF|CNPJ|-)|\s*$)/i
    );
    if (nameMatch) {
      result.name = nameMatch[1].trim().replace(/\s+/g, ' ');
    }
  }

  // Monta o rótulo final para exibição/filtro
  const parts = [];
  if (result.name) parts.push(result.name);
  const acctParts = [];
  if (result.bank) acctParts.push(`Bco ${result.bank}`);
  if (result.branch) acctParts.push(`Ag ${result.branch}`);
  if (result.account) acctParts.push(`Cc ${result.account}`);
  if (acctParts.length) parts.push(acctParts.join(' '));
  result.label = parts.join(' · ');

  return result;
}

/**
 * Formatos de data OFX:
 *  - YYYYMMDD
 *  - YYYYMMDDHHMMSS
 *  - YYYYMMDDHHMMSS.XXX
 *  - YYYYMMDDHHMMSS[offset:TZ]
 */
function parseOFXDate(dateStr) {
  if (!dateStr) return null;
  const clean = dateStr.replace(/\[.*?\]/g, '').trim();
  if (clean.length < 8) return null;
  const y = parseInt(clean.substring(0, 4), 10);
  const m = parseInt(clean.substring(4, 6), 10) - 1;
  const d = parseInt(clean.substring(6, 8), 10);
  let hh = 0, mm = 0, ss = 0;
  if (clean.length >= 14) {
    hh = parseInt(clean.substring(8, 10), 10) || 0;
    mm = parseInt(clean.substring(10, 12), 10) || 0;
    ss = parseInt(clean.substring(12, 14), 10) || 0;
  }
  const date = new Date(y, m, d, hh, mm, ss);
  return isNaN(date.getTime()) ? null : date;
}

// ============================================================
// FORMATAÇÃO
// ============================================================
function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatDate(date) {
  if (!date) return '-';
  return date.toLocaleDateString('pt-BR');
}

/** Data + hora no formato brasileiro (DD/MM/YYYY HH:MM) */
function formatDateTime(date) {
  if (!date) return '-';
  const d = date.toLocaleDateString('pt-BR');
  const t = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${d} ${t}`;
}

function formatDateISO(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Formato YYYY-MM-DDTHH:MM para inputs datetime-local (usa hora local) */
function formatDateTimeLocal(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function getAccountTypeLabel(type) {
  const types = {
    CHECKING: 'Conta Corrente',
    SAVINGS: 'Poupança',
    MONEYMRKT: 'Money Market',
    CREDITLINE: 'Linha de Crédito',
    CD: 'CDB',
  };
  return types[type] || type || '-';
}

function getTrnTypeLabel(type) {
  const types = {
    CREDIT: 'Crédito',
    DEBIT: 'Débito',
    INT: 'Juros',
    DIV: 'Dividendos',
    FEE: 'Tarifa',
    SRVCHG: 'Taxa de Serviço',
    DEP: 'Depósito',
    ATM: 'Saque ATM',
    POS: 'Compra',
    XFER: 'Transferência',
    CHECK: 'Cheque',
    PAYMENT: 'Pagamento',
    CASH: 'Dinheiro',
    DIRECTDEP: 'Depósito Direto',
    DIRECTDEBIT: 'Débito Direto',
    REPEATPMT: 'Pgto Recorrente',
    OTHER: 'Outros',
  };
  return types[type] || type || '-';
}

// ============================================================
// UI - UPLOAD
// ============================================================
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const selectBtn = document.getElementById('select-file-btn');
const errorMsg = document.getElementById('error-msg');
const errorText = document.getElementById('error-text');
const uploadSection = document.getElementById('upload-section');
const dashboard = document.getElementById('dashboard');
const resetBtn = document.getElementById('reset-btn');

selectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

resetBtn.addEventListener('click', () => {
  state.transactions = [];
  state.filtered = [];
  state.accountInfo = {};
  state.currentPage = 1;
  state.pageSize = 100;
  state.selectedIds.clear();
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }
  dashboard.classList.add('hidden');
  uploadSection.classList.remove('hidden');
  // Esconde o botão de recarregar no header
  resetBtn.classList.add('hidden');
  resetBtn.classList.remove('flex', 'inline-flex');
  fileInput.value = '';
  hideError();
});

function showError(message) {
  errorText.textContent = message;
  errorMsg.classList.remove('hidden');
}
function hideError() {
  errorMsg.classList.add('hidden');
}

function handleFile(file) {
  hideError();
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'ofx') {
    showError('Por favor selecione um arquivo com extensão .ofx');
    return;
  }

  // Lemos primeiro como ArrayBuffer para detectar o encoding correto
  // (o OFX declara ENCODING e CHARSET no cabeçalho)
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const buffer = e.target.result;
      const encoding = detectOFXEncoding(buffer);
      const decoder = new TextDecoder(encoding, { fatal: false });
      const content = decoder.decode(buffer);
      const { accountInfo, transactions } = parseOFX(content);
      state.accountInfo = accountInfo;
      state.transactions = transactions;
      state.filtered = [...transactions];
      renderDashboard();
      uploadSection.classList.add('hidden');
      dashboard.classList.remove('hidden');
      // Mostra botão de "Novo arquivo" no header
      resetBtn.classList.remove('hidden');
      resetBtn.classList.add('inline-flex');
    } catch (err) {
      console.error(err);
      showError('Erro ao processar arquivo: ' + err.message);
    }
  };
  reader.onerror = () => showError('Não foi possível ler o arquivo.');
  reader.readAsArrayBuffer(file);
}

/**
 * Detecta o encoding correto lendo o cabeçalho OFX.
 *
 * O padrão OFX 1.x declara duas linhas no cabeçalho:
 *   ENCODING:USASCII | UTF-8 | ...
 *   CHARSET:1252 | 1250 | 8859-1 | ...
 *
 * Bancos brasileiros costumam usar:
 *   - windows-1252 (Itaú, Bradesco, BB) — quando CHARSET=1252
 *   - UTF-8 (Nubank, alguns fintechs)   — quando ENCODING=UTF-8
 *   - ISO-8859-1 (Latin1, alguns)       — quando CHARSET=8859-1
 */
function detectOFXEncoding(buffer) {
  // Lê os primeiros 500 bytes como ASCII para inspecionar o cabeçalho
  const bytes = new Uint8Array(buffer, 0, Math.min(500, buffer.byteLength));
  let header = '';
  for (let i = 0; i < bytes.length; i++) {
    header += String.fromCharCode(bytes[i]);
  }
  header = header.toUpperCase();

  // OFX 2.x (XML) declara encoding no <?xml version=... encoding="..."?>
  const xmlMatch = header.match(/<\?XML[^>]*ENCODING\s*=\s*['"]([^'"]+)['"]/i);
  if (xmlMatch) {
    return normalizeEncoding(xmlMatch[1]);
  }

  // OFX 1.x usa linhas ENCODING: e CHARSET:
  const encLine = header.match(/ENCODING:\s*([A-Z0-9-]+)/);
  const chsLine = header.match(/CHARSET:\s*([A-Z0-9-]+)/);
  const enc = encLine ? encLine[1] : '';
  const chs = chsLine ? chsLine[1] : '';

  if (enc === 'UTF-8' || enc === 'UTF8') return 'utf-8';
  if (chs === '1252') return 'windows-1252';
  if (chs === '1250') return 'windows-1250';
  if (chs === '8859-1' || chs === 'LATIN1') return 'iso-8859-1';
  if (enc === 'USASCII') {
    // USASCII geralmente vem junto com CHARSET=1252 no Brasil; padrão seguro
    return chs === '1252' ? 'windows-1252' : 'windows-1252';
  }

  // Padrão: tenta UTF-8 primeiro (se conteúdo parecer UTF-8 válido, mantém),
  // senão cai para windows-1252 que é o mais comum no Brasil
  if (looksLikeUtf8(buffer)) return 'utf-8';
  return 'windows-1252';
}

function normalizeEncoding(enc) {
  const e = enc.toLowerCase().replace(/[_\s]/g, '-');
  if (e === 'utf8') return 'utf-8';
  if (e === 'latin1') return 'iso-8859-1';
  if (e === 'cp1252') return 'windows-1252';
  return e;
}

/** Heurística: verifica se o buffer parece UTF-8 válido */
function looksLikeUtf8(buffer) {
  const bytes = new Uint8Array(buffer);
  const sampleSize = Math.min(bytes.length, 8192);
  let i = 0;
  while (i < sampleSize) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    // Sequência multi-byte UTF-8
    let extra;
    if ((b & 0xe0) === 0xc0) extra = 1;
    else if ((b & 0xf0) === 0xe0) extra = 2;
    else if ((b & 0xf8) === 0xf0) extra = 3;
    else return false;

    if (i + extra >= sampleSize) return true; // sem certeza mas provável
    for (let j = 1; j <= extra; j++) {
      if ((bytes[i + j] & 0xc0) !== 0x80) return false;
    }
    i += extra + 1;
  }
  return true;
}

// ============================================================
// RENDERIZAÇÃO
// ============================================================
function renderDashboard() {
  renderAccountInfo();
  setupFilters();
  updateReversalUI();
  applyFilters();
}

/**
 * Mostra/oculta o filtro de estorno baseado na presença de estornos no arquivo.
 * Também atualiza o contador no badge.
 */
function updateReversalUI() {
  const wrapper = document.getElementById('reversal-filter-wrapper');
  const countEl = document.getElementById('reversal-count');
  if (!wrapper || !countEl) return;
  const total = state.transactions.filter((t) => t.isReversal).length;
  countEl.textContent = String(total);
  if (total > 0) {
    wrapper.classList.remove('hidden');
  } else {
    wrapper.classList.add('hidden');
  }
}

function renderAccountInfo() {
  const info = state.accountInfo;
  const details = document.getElementById('account-details');
  const items = [
    { label: 'Banco', value: info.bankId || '-', icon: 'fa-university' },
    { label: 'Agência', value: info.branchId || '-', icon: 'fa-code-branch' },
    { label: 'Conta', value: info.accountId || '-', icon: 'fa-id-card' },
    { label: 'Tipo', value: getAccountTypeLabel(info.accountType), icon: 'fa-tag' },
    {
      label: 'Período',
      value: `${formatDate(info.startDate)} até ${formatDate(info.endDate)}`,
      icon: 'fa-calendar-alt',
    },
    {
      label: 'Saldo em ' + formatDate(info.balanceDate),
      value: formatCurrency(info.balance),
      icon: 'fa-wallet',
    },
    { label: 'Moeda', value: info.currency, icon: 'fa-coins' },
    {
      label: 'Total de Transações',
      value: state.transactions.length,
      icon: 'fa-exchange-alt',
    },
  ];
  details.innerHTML = items
    .map(
      (item) => `
      <div class="bg-gray-50 dark:bg-slate-900/50 rounded-lg p-3 w-full text-center">
        <div class="text-xs text-gray-500 dark:text-slate-400 uppercase font-semibold">
          <i class="fas ${item.icon} mr-1"></i>${item.label}
        </div>
        <div class="text-sm font-semibold text-gray-800 dark:text-slate-100 mt-1 break-words">${item.value}</div>
      </div>`
    )
    .join('');
}

// ============================================================
// FILTROS
// ============================================================
const filterType = document.getElementById('filter-type');
const filterStart = document.getElementById('filter-start');
const filterEnd = document.getElementById('filter-end');
const filterSearch = document.getElementById('filter-search');
const filterCounterparty = document.getElementById('filter-counterparty');
const filterMin = document.getElementById('filter-min');
const filterMax = document.getElementById('filter-max');
const filterSort = document.getElementById('filter-sort');
const clearBtn = document.getElementById('clear-filters');
const exportBtn = document.getElementById('export-csv');
const pageSizeSelect = document.getElementById('page-size');
const counterpartyList = document.getElementById('counterparty-list');

function setupFilters() {
  // Define datas iniciais baseadas nas transações (com hora)
  if (state.accountInfo.startDate) {
    // Inicia à meia-noite do primeiro dia
    const startAtMidnight = new Date(state.accountInfo.startDate);
    startAtMidnight.setHours(0, 0, 0, 0);
    filterStart.value = formatDateTimeLocal(startAtMidnight);
  }
  if (state.accountInfo.endDate) {
    // Final até 23:59 do último dia
    const endAtEndOfDay = new Date(state.accountInfo.endDate);
    endAtEndOfDay.setHours(23, 59, 0, 0);
    filterEnd.value = formatDateTimeLocal(endAtEndOfDay);
  }

  // Popula datalist de contrapartes (autocomplete)
  populateCounterpartyList();

  const filterEls = [
    filterType,
    filterStart,
    filterEnd,
    filterSearch,
    filterCounterparty,
    filterMin,
    filterMax,
    filterSort,
  ];
  filterEls.forEach((el) => {
    const handler = () => {
      state.currentPage = 1;
      applyFilters();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  // Filtro estorno (checkbox)
  const filterReversal = document.getElementById('filter-reversal');
  if (filterReversal) {
    filterReversal.addEventListener('change', () => {
      state.currentPage = 1;
      applyFilters();
    });
  }

  // Regra de coer\u00eancia: quando o TIPO muda, valida se o filtro de contraparte
  // ainda \u00e9 v\u00e1lido no novo escopo (n\u00e3o pode divergir).
  filterType.addEventListener('change', () => {
    const cpValue = filterCounterparty.value.trim().toLowerCase();
    if (!cpValue) return;
    const typeF = filterType.value;
    const entry = state.counterpartyList.find(
      ([n]) => n.toLowerCase() === cpValue
    );
    if (!entry) return;
    const [, data] = entry;
    // Se filtrou por CR\u00c9DITO mas a contraparte s\u00f3 tem d\u00e9bitos (ou vice-versa),
    // limpa o filtro de contraparte automaticamente
    if (typeF === 'credit' && data.creditCount === 0) {
      filterCounterparty.value = '';
    } else if (typeF === 'debit' && data.debitCount === 0) {
      filterCounterparty.value = '';
    }
  });

  // Mudança de tamanho de página
  pageSizeSelect.addEventListener('change', () => {
    state.pageSize = parseInt(pageSizeSelect.value, 10) || 100;
    state.currentPage = 1;
    renderTable();
  });

  // Botões de paginação
  document.getElementById('page-first').addEventListener('click', () => goToPage(1));
  document.getElementById('page-prev').addEventListener('click', () => goToPage(state.currentPage - 1));
  document.getElementById('page-next').addEventListener('click', () => goToPage(state.currentPage + 1));
  document.getElementById('page-last').addEventListener('click', () => goToPage(totalPages()));

  clearBtn.addEventListener('click', () => {
    filterType.value = 'all';
    filterStart.value = '';
    filterEnd.value = '';
    filterSearch.value = '';
    filterCounterparty.value = '';
    filterMin.value = '';
    filterMax.value = '';
    filterSort.value = 'date-desc';
    state.currentPage = 1;
    applyFilters();
  });

  exportBtn.addEventListener('click', exportCSV);
}

/**
 * Popula o mapa completo de contrapartes com totais por tipo.
 * Chamado uma vez ao carregar o arquivo.
 */
function populateCounterpartyList() {
  const nameCount = new Map();
  state.transactions.forEach((t) => {
    const key = t.counterpartyName || t.counterparty;
    if (!key) return;
    if (!nameCount.has(key)) {
      nameCount.set(key, {
        count: 0,
        creditCount: 0,
        debitCount: 0,
        reversalCount: 0,        // total de estornos com essa contraparte
        totalCredit: 0,
        totalDebit: 0,
        totalReversal: 0,        // valor absoluto acumulado dos estornos
      });
    }
    const entry = nameCount.get(key);
    entry.count++;
    if (t.type === 'credit') {
      entry.creditCount++;
      entry.totalCredit += t.amount;
    } else {
      entry.debitCount++;
      entry.totalDebit += t.absAmount;
    }
    if (t.isReversal) {
      entry.reversalCount++;
      entry.totalReversal += t.absAmount;
    }
  });
  const sorted = [...nameCount.entries()].sort((a, b) => b[1].count - a[1].count);
  state.counterpartyList = sorted;
  renderCounterpartyPanel();
}

/**
 * Renderiza o painel de contrapartes, respeitando o filtro de tipo.
 *  - Se tipo = "credit", mostra apenas contrapartes com créditos
 *  - Se tipo = "debit", mostra apenas contrapartes com débitos
 *  - Se tipo = "all", mostra todas
 * Atualiza também o datalist do autocomplete com o mesmo escopo.
 */
function renderCounterpartyPanel() {
  const panel = document.getElementById('counterparty-panel');
  const countLabel = document.getElementById('counterparty-count');
  if (!panel) return;

  const typeFilter = filterType.value; // 'all' | 'credit' | 'debit'

  // Filtra a lista pela tipagem selecionada
  const scoped = (state.counterpartyList || []).filter(([, data]) => {
    if (typeFilter === 'credit') return data.creditCount > 0;
    if (typeFilter === 'debit') return data.debitCount > 0;
    return true;
  });

  // Atualiza datalist do input (para autocomplete)
  if (counterpartyList) {
    counterpartyList.innerHTML = scoped
      .map(([name, data]) => {
        const info =
          typeFilter === 'credit'
            ? `${data.creditCount} crédito(s)`
            : typeFilter === 'debit'
            ? `${data.debitCount} débito(s)`
            : `${data.count} transação(ões)`;
        return `<option value="${escapeHtml(name)}" label="${escapeHtml(info)}"></option>`;
      })
      .join('');
  }

  if (scoped.length === 0) {
    panel.innerHTML =
      '<p class="text-xs text-slate-400 italic p-2 col-span-full">Nenhuma contraparte encontrada para este tipo.</p>';
    if (countLabel) countLabel.textContent = '';
    return;
  }
  if (countLabel) {
    const total = state.counterpartyList.length;
    const shown = scoped.length;
    countLabel.textContent =
      typeFilter === 'all' ? `(${total})` : `(${shown} de ${total})`;
  }

  const currentFilter = filterCounterparty.value.trim().toLowerCase();
  panel.innerHTML = scoped
    .map(([name, data]) => {
      const isActive = currentFilter && name.toLowerCase() === currentFilter;
      const activeClass = isActive
        ? 'bg-blue-100 dark:bg-blue-900 border-blue-400 dark:border-blue-500 text-blue-800 dark:text-blue-200'
        : 'bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200';
      const flows = [];
      // No modo "credit" só mostra crédito; "debit" só débito; "all" mostra ambos
      if (typeFilter !== 'debit' && data.totalCredit > 0) {
        flows.push(
          `<span class="text-green-600 dark:text-green-400" title="Créditos"><i class="fas fa-arrow-up"></i> ${formatCurrency(
            data.totalCredit
          )}</span>`
        );
      }
      if (typeFilter !== 'credit' && data.totalDebit > 0) {
        flows.push(
          `<span class="text-red-600 dark:text-red-400" title="Débitos"><i class="fas fa-arrow-down"></i> ${formatCurrency(
            data.totalDebit
          )}</span>`
        );
      }
      // Estornos: aparecem apenas em modo "todos" (nos outros modos o valor já
      // está contado em créditos/débitos da própria transação)
      if (typeFilter === 'all' && data.reversalCount > 0) {
        flows.push(
          `<span class="text-amber-600 dark:text-amber-400" title="Estornos/devoluções"><i class="fas fa-undo"></i> ${data.reversalCount} · ${formatCurrency(
            data.totalReversal
          )}</span>`
        );
      }
      const shownCount =
        typeFilter === 'credit'
          ? data.creditCount
          : typeFilter === 'debit'
          ? data.debitCount
          : data.count;
      // Badge de estorno na frente do nome quando em modo "todos"
      const reversalBadge =
        typeFilter === 'all' && data.reversalCount > 0
          ? `<span class="badge badge-reversal ml-1 align-middle" title="${data.reversalCount} estorno(s)"><i class="fas fa-undo mr-0.5"></i>${data.reversalCount}</span>`
          : '';
      return `
        <button type="button" data-cp="${escapeHtml(name)}"
          class="counterparty-item text-left w-full border ${activeClass} rounded-lg px-3 py-2 text-xs transition">
          <div class="font-semibold truncate">${escapeHtml(name)}${reversalBadge}</div>
          <div class="flex items-center justify-between mt-1 gap-2">
            <span class="text-gray-500 dark:text-slate-400 whitespace-nowrap">${shownCount} trans.</span>
            <div class="flex gap-2 text-[11px] flex-wrap justify-end">${flows.join('')}</div>
          </div>
        </button>`;
    })
    .join('');

  panel.querySelectorAll('.counterparty-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-cp');
      // Toggle: se já está selecionado, limpa
      if (filterCounterparty.value.trim() === name) {
        filterCounterparty.value = '';
      } else {
        filterCounterparty.value = name;
      }
      state.currentPage = 1;
      applyFilters();
    });
  });
}

/**
 * Parseia a string de busca em tokens.
 * Regras:
 *  - "frase entre aspas" → busca exata pela frase
 *  - -palavra            → exclui resultados com essa palavra
 *  - palavra palavra     → todas devem estar presentes (AND)
 */
function parseSearchQuery(query) {
  const tokens = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = regex.exec(query)) !== null) {
    let value = m[1] || m[2];
    let exclude = false;
    if (!m[1] && value.startsWith('-') && value.length > 1) {
      exclude = true;
      value = value.substring(1);
    }
    if (value) tokens.push({ value, exclude });
  }
  return tokens;
}

/** Normaliza texto para busca: minúsculo + sem acento */
function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Parseia número em formato brasileiro (R$ 10.000,00) ou americano (10000.00)
 * Aceita:
 *  - "10.000,00"     → 10000
 *  - "R$ 10.000,00"  → 10000
 *  - "10000,00"      → 10000
 *  - "10000.00"      → 10000 (formato americano)
 *  - "1000"          → 1000
 *  - "1,5"           → 1.5
 *  - ""              → null
 */
function parseBRNumber(str) {
  if (str === null || str === undefined) return null;
  let s = String(str).trim();
  if (!s) return null;
  // Remove símbolos de moeda e espaços
  s = s.replace(/R\$|\s/g, '').replace(/[^\d,.\-+]/g, '');
  if (!s) return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Ambos presentes: vírgula é decimal, ponto é milhar (padrão BR)
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Só vírgula: decimal BR
    s = s.replace(',', '.');
  } else if (hasDot) {
    // Só ponto: pode ser decimal (10.50) ou milhar (10.000)
    // Se tem mais de um ponto ou o segmento após o último ponto tem 3 dígitos, é milhar
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      s = s.replace(/\./g, '');
    }
    // senão mantém como decimal americano
  }

  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function totalPages() {
  return Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
}

function goToPage(n) {
  const max = totalPages();
  state.currentPage = Math.min(Math.max(1, n), max);
  renderTable();
}

function applyFilters() {
  let result = [...state.transactions];

  // Filtro por tipo
  if (filterType.value === 'credit') {
    result = result.filter((t) => t.type === 'credit');
  } else if (filterType.value === 'debit') {
    result = result.filter((t) => t.type === 'debit');
  }

  // Filtro por data/hora (datetime-local dá valor no formato YYYY-MM-DDTHH:MM em hora local)
  if (filterStart.value) {
    const start = new Date(filterStart.value);
    if (!isNaN(start.getTime())) {
      result = result.filter((t) => t.date && t.date >= start);
    }
  }
  if (filterEnd.value) {
    const end = new Date(filterEnd.value);
    if (!isNaN(end.getTime())) {
      result = result.filter((t) => t.date && t.date <= end);
    }
  }

  // Filtro por descrição - BUSCA AVANÇADA COMBINADA
  // Suporta múltiplas palavras (todas devem existir, em qualquer ordem)
  // Suporta "-palavra" para excluir e "frase entre aspas" para busca exata
  // Ex.: pix joão            → contém "pix" E "joão"
  // Ex.: pix -reembolso      → contém "pix" mas NÃO "reembolso"
  // Ex.: "netflix assinatura" → contém a frase exata
  const searchRaw = filterSearch.value.trim();
  if (searchRaw) {
    const tokens = parseSearchQuery(searchRaw);
    result = result.filter((t) => {
      const haystack = normalizeText(
        `${t.description || ''} ${t.memo || ''} ${t.name || ''} ${t.trnType || ''}`
      );
      return tokens.every((tok) => {
        const needle = normalizeText(tok.value);
        const found = haystack.includes(needle);
        return tok.exclude ? !found : found;
      });
    });
  }

  // Filtro por conta destino/origem (contraparte) - também com busca combinada
  const cpRaw = filterCounterparty.value.trim();
  if (cpRaw) {
    const tokens = parseSearchQuery(cpRaw);
    result = result.filter((t) => {
      const haystack = normalizeText(
        `${t.counterparty || ''} ${t.counterpartyName || ''} ${
          t.counterpartyAccount || ''
        } ${t.counterpartyBank || ''} ${t.counterpartyBranch || ''}`
      );
      return tokens.every((tok) => {
        const needle = normalizeText(tok.value);
        const found = haystack.includes(needle);
        return tok.exclude ? !found : found;
      });
    });
  }

  // Filtro por valor (aceita formato BR)
  const minV = parseBRNumber(filterMin.value);
  const maxV = parseBRNumber(filterMax.value);
  if (minV !== null) result = result.filter((t) => t.absAmount >= minV);
  if (maxV !== null) result = result.filter((t) => t.absAmount <= maxV);

  // Filtro por estorno/devolução
  const filterReversalEl = document.getElementById('filter-reversal');
  if (filterReversalEl) {
    const rvMode = filterReversalEl.value;
    if (rvMode === 'only') result = result.filter((t) => t.isReversal);
    else if (rvMode === 'exclude') result = result.filter((t) => !t.isReversal);
  }

  // Ordenação
  switch (filterSort.value) {
    case 'date-asc':
      result.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
      break;
    case 'date-desc':
      result.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
      break;
    case 'value-desc':
      result.sort((a, b) => b.absAmount - a.absAmount);
      break;
    case 'value-asc':
      result.sort((a, b) => a.absAmount - b.absAmount);
      break;
    case 'desc-asc':
      result.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
      break;
  }

  state.filtered = result;

  // Limpa selectedIds que não estão mais visíveis após aplicar os filtros
  if (state.selectedIds.size > 0) {
    const visibleIds = new Set(result.map((t) => t.id));
    for (const id of Array.from(state.selectedIds)) {
      if (!visibleIds.has(id)) state.selectedIds.delete(id);
    }
  }

  renderTable();
  renderStats();
  renderChart();
  renderCounterpartyPanel(); // atualiza destaque da lista lateral
}

// ============================================================
// TABELA
// ============================================================
function renderTable() {
  const tbody = document.getElementById('transactions-tbody');
  const mobile = document.getElementById('transactions-mobile');
  const emptyState = document.getElementById('empty-state');
  const filteredCount = document.getElementById('filtered-count');
  const filteredTotal = document.getElementById('filtered-total');
  const filteredTotalMobile = document.getElementById('filtered-total-mobile');
  const pagination = document.getElementById('pagination');

  filteredCount.textContent = `(${state.filtered.length} de ${state.transactions.length})`;

  if (state.filtered.length === 0) {
    tbody.innerHTML = '';
    if (mobile) mobile.innerHTML = '';
    emptyState.classList.remove('hidden');
    pagination.classList.add('hidden');
    filteredTotal.textContent = formatCurrency(0);
    if (filteredTotalMobile) filteredTotalMobile.textContent = formatCurrency(0);
    return;
  }
  emptyState.classList.add('hidden');

  // Paginação
  const total = state.filtered.length;
  const pages = totalPages();
  if (state.currentPage > pages) state.currentPage = pages;
  const startIdx = (state.currentPage - 1) * state.pageSize;
  const endIdx = Math.min(startIdx + state.pageSize, total);
  const pageItems = state.filtered.slice(startIdx, endIdx);

  // Renderização desktop (tabela)
  tbody.innerHTML = pageItems
    .map((t) => {
      const badgeClass = t.type === 'credit' ? 'badge-credit' : 'badge-debit';
      const valueClass = t.type === 'credit' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
      const sign = t.type === 'credit' ? '+' : '-';
      const cpLabel = t.type === 'credit' ? 'De' : 'Para';
      const cpDisplay = t.counterparty
        ? `<span class="text-gray-400 dark:text-slate-500 mr-1">${cpLabel}:</span>${escapeHtml(t.counterparty)}`
        : '<span class="text-gray-300 dark:text-slate-600">-</span>';
      const reversalBadge = t.isReversal
        ? `<span class="badge badge-reversal ml-1" title="${escapeHtml(t.reversalReason || 'Estorno')}"><i class="fas fa-undo mr-1"></i>${escapeHtml(t.reversalReason || 'Estorno')}</span>`
        : '';
      const isSelected = state.selectedIds.has(t.id);
      const rowClass = isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : '';
      const balBefore = t.balanceBefore != null
        ? `<span class="text-gray-600 dark:text-slate-300">${formatCurrency(t.balanceBefore)}</span>`
        : '<span class="text-gray-300 dark:text-slate-600">-</span>';
      const balAfter = t.balanceAfter != null
        ? `<span class="${t.balanceAfter >= 0 ? 'text-gray-800 dark:text-slate-100 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}">${formatCurrency(t.balanceAfter)}</span>`
        : '<span class="text-gray-300 dark:text-slate-600">-</span>';
      return `
        <tr class="${rowClass}">
          <td class="px-2 py-3 text-center">
            <input type="checkbox" class="row-checkbox rounded border-gray-300 dark:border-slate-500 text-blue-600 focus:ring-blue-500 cursor-pointer" data-id="${escapeHtml(t.id)}" ${isSelected ? 'checked' : ''} />
          </td>
          <td class="px-3 py-3 text-sm text-gray-700 dark:text-slate-300 whitespace-nowrap">${formatDateTime(t.date)}</td>
          <td class="px-3 py-3 whitespace-nowrap">
            <span class="badge ${badgeClass}">
              <i class="fas fa-${t.type === 'credit' ? 'arrow-up' : 'arrow-down'} mr-1"></i>
              ${getTrnTypeLabel(t.trnType)}
            </span>
            ${reversalBadge}
          </td>
          <td class="px-3 py-3 text-sm text-gray-800 dark:text-slate-200 max-w-md">${escapeHtml(t.description)}</td>
          <td class="px-3 py-3 text-sm text-gray-700 dark:text-slate-300">${cpDisplay}</td>
          <td class="px-3 py-3 text-xs text-gray-500 dark:text-slate-400 font-mono">${escapeHtml(t.id || '-')}</td>
          <td class="px-3 py-3 text-sm font-semibold text-right whitespace-nowrap ${valueClass}">
            ${sign} ${formatCurrency(t.absAmount)}
          </td>
          <td class="px-3 py-3 text-xs text-right whitespace-nowrap">${balBefore}</td>
          <td class="px-3 py-3 text-xs text-right whitespace-nowrap">${balAfter}</td>
        </tr>
      `;
    })
    .join('');

  // Renderização mobile (cards)
  if (mobile) {
    mobile.innerHTML = pageItems
      .map((t) => {
        const badgeClass = t.type === 'credit' ? 'badge-credit' : 'badge-debit';
        const valueClass = t.type === 'credit' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
        const sign = t.type === 'credit' ? '+' : '-';
        const cpLabel = t.type === 'credit' ? 'De' : 'Para';
        const reversalBadge = t.isReversal
          ? `<span class="badge badge-reversal ml-1"><i class="fas fa-undo mr-1"></i>${escapeHtml(t.reversalReason || 'Estorno')}</span>`
          : '';
        const isSelected = state.selectedIds.has(t.id);
        const cardClass = isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : '';
        const balanceLine =
          t.balanceBefore != null && t.balanceAfter != null
            ? `<div class="text-[11px] text-gray-500 dark:text-slate-400 flex items-center gap-1 flex-wrap">
                 <span>Saldo:</span>
                 <span>${formatCurrency(t.balanceBefore)}</span>
                 <i class="fas fa-arrow-right text-gray-400"></i>
                 <span class="${t.balanceAfter >= 0 ? 'text-gray-700 dark:text-slate-200 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}">${formatCurrency(t.balanceAfter)}</span>
               </div>`
            : '';
        return `
          <div class="p-3 space-y-1 ${cardClass}">
            <div class="flex items-start justify-between gap-2">
              <label class="flex items-start gap-2 flex-1 cursor-pointer">
                <input type="checkbox" class="row-checkbox mt-1 rounded border-gray-300 dark:border-slate-500 text-blue-600 focus:ring-blue-500" data-id="${escapeHtml(t.id)}" ${isSelected ? 'checked' : ''} />
                <div class="flex items-center flex-wrap gap-1 flex-1">
                  <span class="badge ${badgeClass}">
                    <i class="fas fa-${t.type === 'credit' ? 'arrow-up' : 'arrow-down'} mr-1"></i>
                    ${getTrnTypeLabel(t.trnType)}
                  </span>
                  ${reversalBadge}
                </div>
              </label>
              <div class="text-sm font-bold whitespace-nowrap ${valueClass}">${sign} ${formatCurrency(t.absAmount)}</div>
            </div>
            <div class="text-xs text-gray-500 dark:text-slate-400">
              <i class="far fa-clock mr-1"></i>${formatDateTime(t.date)}
            </div>
            <div class="text-sm text-gray-800 dark:text-slate-100 break-words">${escapeHtml(t.description)}</div>
            ${t.counterparty ? `<div class="text-xs text-gray-600 dark:text-slate-300"><span class="text-gray-400 dark:text-slate-500">${cpLabel}:</span> ${escapeHtml(t.counterparty)}</div>` : ''}
            ${balanceLine}
            ${t.id ? `<div class="text-[11px] text-gray-400 dark:text-slate-500 font-mono">TxId: ${escapeHtml(t.id)}</div>` : ''}
          </div>
        `;
      })
      .join('');
  }

  // Se há seleção, o total mostrado é dos itens selecionados; caso contrário, é o total filtrado.
  const totals = computeDisplayTotals();
  const totalClass =
    'px-3 py-3 text-right font-bold ' +
    (totals.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400');
  filteredTotal.textContent = formatCurrency(totals.value);
  filteredTotal.className = totalClass;
  if (filteredTotalMobile) {
    filteredTotalMobile.textContent = formatCurrency(totals.value);
    filteredTotalMobile.className =
      (totals.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400') +
      ' font-bold';
  }
  // Atualiza label "Total filtrado:" para " Total da seleção:" quando há seleção
  const totalLabel = document.getElementById('filtered-total-label');
  const totalLabelMobile = document.getElementById('filtered-total-label-mobile');
  const labelText = totals.selected ? ` da seleção (${totals.count}):` : ':';
  if (totalLabel) totalLabel.textContent = labelText;
  if (totalLabelMobile) totalLabelMobile.textContent = labelText;

  // Liga eventos de checkbox
  wireRowCheckboxes();
  updateSelectionUI();

  // Atualiza barra de paginação
  renderPagination(startIdx + 1, endIdx, total, pages);
}

/**
 * Retorna o total a ser exibido no rodapé:
 * - Se há seleção, retorna soma dos itens selecionados
 * - Caso contrário, retorna soma de todos os filtrados
 */
function computeDisplayTotals() {
  if (state.selectedIds.size > 0) {
    const selected = state.filtered.filter((t) => state.selectedIds.has(t.id));
    const value = selected.reduce((s, t) => s + t.amount, 0);
    return { value, count: selected.length, selected: true };
  }
  const value = state.filtered.reduce((s, t) => s + t.amount, 0);
  return { value, count: state.filtered.length, selected: false };
}

/**
 * Conecta os checkboxes de linha (desktop + mobile) e o "selecionar todos".
 * Chamado toda vez que a tabela é re-renderizada.
 */
function wireRowCheckboxes() {
  document.querySelectorAll('.row-checkbox').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      if (e.target.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      // Re-render leve: só atualiza totais + destaque + header checkbox
      updateSelectionUI();
      updateRowHighlight();
      updateTotalsOnSelection();
      renderStats();
    });
  });

  const selectAll = document.getElementById('select-all-header');
  if (selectAll) {
    // Estado do "todos": marcado se todos os itens da PÁGINA estão selecionados
    const pageIds = getVisiblePageIds();
    const allChecked = pageIds.length > 0 && pageIds.every((id) => state.selectedIds.has(id));
    const someChecked = pageIds.some((id) => state.selectedIds.has(id));
    selectAll.checked = allChecked;
    selectAll.indeterminate = someChecked && !allChecked;

    selectAll.onchange = (e) => {
      const check = e.target.checked;
      pageIds.forEach((id) => {
        if (check) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
      });
      renderTable();
      renderStats();
    };
  }
}

function getVisiblePageIds() {
  const startIdx = (state.currentPage - 1) * state.pageSize;
  const endIdx = Math.min(startIdx + state.pageSize, state.filtered.length);
  return state.filtered.slice(startIdx, endIdx).map((t) => t.id);
}

/**
 * Atualiza contador de seleção no cabeçalho e botão de limpar seleção.
 */
function updateSelectionUI() {
  const countEl = document.getElementById('selection-count');
  const clearBtn = document.getElementById('clear-selection');
  const n = state.selectedIds.size;
  if (countEl) {
    if (n > 0) {
      countEl.textContent = `· ${n} selecionada${n > 1 ? 's' : ''}`;
      countEl.classList.remove('hidden');
    } else {
      countEl.classList.add('hidden');
    }
  }
  if (clearBtn) {
    if (n > 0) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
}

function updateRowHighlight() {
  document.querySelectorAll('.row-checkbox').forEach((cb) => {
    const id = cb.getAttribute('data-id');
    const row = cb.closest('tr, .p-3');
    if (!row) return;
    if (state.selectedIds.has(id)) {
      row.classList.add('bg-blue-50', 'dark:bg-blue-900/20');
    } else {
      row.classList.remove('bg-blue-50', 'dark:bg-blue-900/20');
    }
  });
}

function updateTotalsOnSelection() {
  const filteredTotal = document.getElementById('filtered-total');
  const filteredTotalMobile = document.getElementById('filtered-total-mobile');
  const totalLabel = document.getElementById('filtered-total-label');
  const totalLabelMobile = document.getElementById('filtered-total-label-mobile');
  const totals = computeDisplayTotals();
  if (filteredTotal) {
    filteredTotal.textContent = formatCurrency(totals.value);
    filteredTotal.className =
      'px-3 py-3 text-right font-bold ' +
      (totals.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400');
  }
  if (filteredTotalMobile) {
    filteredTotalMobile.textContent = formatCurrency(totals.value);
    filteredTotalMobile.className =
      (totals.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400') +
      ' font-bold';
  }
  const labelText = totals.selected ? ` da seleção (${totals.count}):` : ':';
  if (totalLabel) totalLabel.textContent = labelText;
  if (totalLabelMobile) totalLabelMobile.textContent = labelText;
}

function renderPagination(from, to, total, pages) {
  const pagination = document.getElementById('pagination');
  const info = document.getElementById('pagination-info');
  const indicator = document.getElementById('page-indicator');

  // Só mostra paginação se há mais de uma página
  if (pages <= 1) {
    pagination.classList.add('hidden');
    return;
  }
  pagination.classList.remove('hidden');
  pagination.classList.add('flex');

  info.textContent = `Exibindo ${from}-${to} de ${total} transações`;
  indicator.textContent = `Página ${state.currentPage} de ${pages}`;

  document.getElementById('page-first').disabled = state.currentPage === 1;
  document.getElementById('page-prev').disabled = state.currentPage === 1;
  document.getElementById('page-next').disabled = state.currentPage === pages;
  document.getElementById('page-last').disabled = state.currentPage === pages;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// ESTATÍSTICAS
// ============================================================
function renderStats() {
  // Quando há seleção, o painel de stats mostra dados da seleção.
  // Isso permite ao usuário somar 3 débitos específicos, por exemplo.
  const source =
    state.selectedIds.size > 0
      ? state.filtered.filter((t) => state.selectedIds.has(t.id))
      : state.filtered;

  const credits = source.filter((t) => t.type === 'credit');
  const debits = source.filter((t) => t.type === 'debit');

  const totalCredit = credits.reduce((s, t) => s + t.amount, 0);
  const totalDebit = debits.reduce((s, t) => s + t.absAmount, 0);
  const balance = totalCredit - totalDebit;
  const avg =
    source.length > 0 ? source.reduce((s, t) => s + t.absAmount, 0) / source.length : 0;

  document.getElementById('stat-count').textContent = source.length;
  document.getElementById('stat-credit').textContent = formatCurrency(totalCredit);
  document.getElementById('stat-credit-count').textContent = `${credits.length} entradas`;
  document.getElementById('stat-debit').textContent = formatCurrency(totalDebit);
  document.getElementById('stat-debit-count').textContent = `${debits.length} saídas`;
  const balanceEl = document.getElementById('stat-balance');
  balanceEl.textContent = formatCurrency(balance);
  balanceEl.className =
    'text-base sm:text-2xl font-bold mt-1 ' +
    (balance >= 0
      ? 'text-indigo-600 dark:text-indigo-400'
      : 'text-red-600 dark:text-red-400');
  document.getElementById('stat-avg').textContent = formatCurrency(avg);
}

// ============================================================
// GRÁFICO
// ============================================================
function renderChart() {
  const ctx = document.getElementById('daily-chart');
  if (!ctx) return;

  // Agrupa por dia
  const dailyMap = new Map();
  state.filtered.forEach((t) => {
    if (!t.date) return;
    const key = formatDateISO(t.date);
    if (!dailyMap.has(key)) {
      dailyMap.set(key, { credit: 0, debit: 0 });
    }
    const d = dailyMap.get(key);
    if (t.type === 'credit') d.credit += t.amount;
    else d.debit += t.absAmount;
  });

  const sortedKeys = [...dailyMap.keys()].sort();
  const labels = sortedKeys.map((k) => {
    const [y, m, d] = k.split('-');
    return `${d}/${m}`;
  });
  const creditData = sortedKeys.map((k) => dailyMap.get(k).credit);
  const debitData = sortedKeys.map((k) => dailyMap.get(k).debit);

  if (state.chart) {
    state.chart.destroy();
  }

  // Cores adaptativas ao tema atual
  const isDark = document.documentElement.classList.contains('dark');
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(0, 0, 0, 0.08)';
  const tickColor = isDark ? '#cbd5e1' : '#475569';

  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Créditos',
          data: creditData,
          backgroundColor: 'rgba(34, 197, 94, 0.7)',
          borderColor: 'rgb(34, 197, 94)',
          borderWidth: 1,
        },
        {
          label: 'Débitos',
          data: debitData,
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderColor: 'rgb(239, 68, 68)',
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: tickColor } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: tickColor },
          grid: { color: gridColor },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: tickColor,
            callback: (value) =>
              new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
                maximumFractionDigits: 0,
              }).format(value),
          },
          grid: { color: gridColor },
        },
      },
    },
  });
}

// ============================================================
// EXPORTAÇÃO CSV
// ============================================================
function exportCSV() {
  // Se há seleção, exporta apenas os selecionados; senão, todos os filtrados
  const source =
    state.selectedIds.size > 0
      ? state.filtered.filter((t) => state.selectedIds.has(t.id))
      : state.filtered;
  if (source.length === 0) {
    alert('Nenhuma transação para exportar.');
    return;
  }
  const headers = [
    'Data/Hora',
    'Tipo',
    'Descrição',
    'Conta Destino/Origem',
    'TxId',
    'Valor',
    'Saldo Antes',
    'Saldo Após',
    'Estorno',
  ];
  const rows = source.map((t) => [
    formatDateTime(t.date),
    getTrnTypeLabel(t.trnType),
    t.description.replace(/"/g, '""'),
    (t.counterparty || '').replace(/"/g, '""'),
    t.id || '',
    t.amount.toFixed(2).replace('.', ','),
    t.balanceBefore != null ? t.balanceBefore.toFixed(2).replace('.', ',') : '',
    t.balanceAfter != null ? t.balanceAfter.toFixed(2).replace('.', ',') : '',
    t.isReversal ? t.reversalReason || 'Sim' : '',
  ]);
  const csv = [
    headers.join(';'),
    ...rows.map((r) => r.map((c) => `"${c}"`).join(';')),
  ].join('\n');

  // BOM para Excel abrir corretamente com UTF-8
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `extrato_${formatDateISO(new Date())}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================
// EXPORTAÇÃO PDF
// ============================================================
/**
 * Gera relatório PDF do extrato com:
 *  - Cabeçalho (informações da conta)
 *  - Resumo estatístico (créditos, débitos, saldo, ticket médio)
 *  - Filtros aplicados
 *  - Tabela de transações
 *  - Total filtrado no rodapé
 * Usa jsPDF + autotable (carregados via CDN).
 */
function exportPDF() {
  // Se há seleção, exporta apenas os selecionados
  const source =
    state.selectedIds.size > 0
      ? state.filtered.filter((t) => state.selectedIds.has(t.id))
      : state.filtered;
  if (source.length === 0) {
    alert('Nenhuma transação para exportar.');
    return;
  }
  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
    alert('Biblioteca de PDF não carregada. Recarregue a página e tente novamente.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Cabeçalho
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Relatório de Extrato Bancário', pageWidth / 2, 15, { align: 'center' });

  const info = state.accountInfo;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const accountLines = [
    `Banco: ${info.bankId || '-'}   Agência: ${info.branchId || '-'}   Conta: ${info.accountId || '-'} (${getAccountTypeLabel(info.accountType)})`,
    `Período: ${formatDate(info.startDate)} até ${formatDate(info.endDate)}   Saldo: ${formatCurrency(info.balance)} em ${formatDate(info.balanceDate)}`,
    `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
  ];
  let y = 22;
  accountLines.forEach((l) => {
    doc.text(l, 14, y);
    y += 5;
  });

  // Filtros aplicados
  const filters = [];
  if (filterType.value !== 'all') {
    filters.push(`Tipo: ${filterType.value === 'credit' ? 'Somente créditos' : 'Somente débitos'}`);
  }
  if (filterStart.value) filters.push(`De: ${new Date(filterStart.value).toLocaleString('pt-BR')}`);
  if (filterEnd.value) filters.push(`Até: ${new Date(filterEnd.value).toLocaleString('pt-BR')}`);
  if (filterSearch.value) filters.push(`Busca: "${filterSearch.value}"`);
  if (filterCounterparty.value) filters.push(`Conta: ${filterCounterparty.value}`);
  if (filterMin.value) filters.push(`Mín: ${filterMin.value}`);
  if (filterMax.value) filters.push(`Máx: ${filterMax.value}`);
  const reversalEl = document.getElementById('filter-reversal');
  if (reversalEl && reversalEl.value === 'only') filters.push('Somente estornos');
  if (reversalEl && reversalEl.value === 'exclude') filters.push('Sem estornos');
  if (filters.length) {
    doc.setFont('helvetica', 'bold');
    doc.text('Filtros: ', 14, y);
    doc.setFont('helvetica', 'normal');
    const filtersText = filters.join('  |  ');
    const split = doc.splitTextToSize(filtersText, pageWidth - 40);
    doc.text(split, 30, y);
    y += 5 * split.length;
  }

  // Estatísticas (baseadas em source: seleção OU filtrados)
  const credits = source.filter((t) => t.type === 'credit');
  const debits = source.filter((t) => t.type === 'debit');
  const totalCredit = credits.reduce((s, t) => s + t.amount, 0);
  const totalDebit = debits.reduce((s, t) => s + t.absAmount, 0);
  const balance = totalCredit - totalDebit;
  const reversalCount = source.filter((t) => t.isReversal).length;

  y += 2;
  doc.setFont('helvetica', 'bold');
  const scopeLabel = state.selectedIds.size > 0 ? 'Resumo (seleção):' : 'Resumo:';
  doc.text(scopeLabel, 14, y);
  doc.setFont('helvetica', 'normal');
  const stats = [
    `Transações: ${source.length}`,
    `Créditos: ${formatCurrency(totalCredit)} (${credits.length})`,
    `Débitos: ${formatCurrency(totalDebit)} (${debits.length})`,
    `Saldo: ${formatCurrency(balance)}`,
  ];
  if (reversalCount > 0) stats.push(`Estornos: ${reversalCount}`);
  doc.text(stats.join('   |   '), 40, y);
  y += 6;

  // Tabela de transações
  const rows = source.map((t) => [
    formatDateTime(t.date),
    getTrnTypeLabel(t.trnType) + (t.isReversal ? ' (Estorno)' : ''),
    t.description,
    t.counterparty || '-',
    t.id || '-',
    (t.type === 'credit' ? '+' : '-') + ' ' + formatCurrency(t.absAmount),
    t.balanceBefore != null ? formatCurrency(t.balanceBefore) : '-',
    t.balanceAfter != null ? formatCurrency(t.balanceAfter) : '-',
  ]);

  doc.autoTable({
    startY: y,
    head: [['Data/Hora', 'Tipo', 'Descrição', 'Conta Destino/Origem', 'TxId', 'Valor', 'Saldo Antes', 'Saldo Após']],
    body: rows,
    styles: { fontSize: 6.5, cellPadding: 1.3, overflow: 'linebreak' },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 30 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 45 },
      4: { cellWidth: 22 },
      5: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 24, halign: 'right' },
      7: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const value = source[data.row.index].amount;
        data.cell.styles.textColor = value >= 0 ? [22, 163, 74] : [220, 38, 38];
      }
      // Saldo após negativo em vermelho
      if (data.section === 'body' && data.column.index === 7) {
        const bal = source[data.row.index].balanceAfter;
        if (bal != null && bal < 0) data.cell.styles.textColor = [220, 38, 38];
      }
    },
    didDrawPage: (data) => {
      // Rodapé com paginação
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Página ${data.pageNumber} de ${pageCount}`,
        pageWidth - 14,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'right' }
      );
      doc.text(
        'Leitor OFX · Processado 100% localmente',
        14,
        doc.internal.pageSize.getHeight() - 8
      );
    },
  });

  // Total filtrado ao final
  let endY = doc.lastAutoTable.finalY + 6;
  if (endY > doc.internal.pageSize.getHeight() - 20) {
    doc.addPage();
    endY = 20;
  }
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  const totalLabel =
    state.selectedIds.size > 0
      ? `Total da seleção (${source.length}):`
      : 'Total filtrado:';
  doc.text(totalLabel, pageWidth - 60, endY, { align: 'right' });
  doc.setTextColor(balance >= 0 ? 22 : 220, balance >= 0 ? 163 : 38, balance >= 0 ? 74 : 38);
  doc.text(formatCurrency(balance), pageWidth - 14, endY, { align: 'right' });

  doc.save(`extrato_${formatDateISO(new Date())}.pdf`);
}

// ============================================================
// TEMA CLARO / ESCURO
// ============================================================
/**
 * Aplica o tema (claro ou escuro) e persiste em localStorage.
 * O tema é restaurado imediatamente no <head> (script inline) para evitar flash.
 */
function setTheme(theme) {
  const isDark = theme === 'dark';
  // Aplica a classe .dark no elemento raiz — Tailwind foi configurado com darkMode:'class'
  document.documentElement.classList.toggle('dark', isDark);
  try {
    localStorage.setItem('theme', theme);
  } catch (e) {}
  const icon = document.getElementById('theme-icon');
  if (icon) {
    // No modo escuro mostra o sol (para voltar ao claro); no claro mostra a lua
    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
  }
  // Se o gráfico existe, re-renderiza para atualizar cores das grades/labels
  try {
    if (state.chart && state.filtered && state.filtered.length > 0) {
      renderChart();
    }
  } catch (e) {
    console.warn('Erro ao atualizar gráfico após mudança de tema:', e);
  }
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem('theme');
  } catch (e) {}
  // Só respeita prefers-color-scheme se NÃO houver preferência salva
  const prefersDark =
    !saved &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  setTheme(theme);
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const isDark = document.documentElement.classList.contains('dark');
      setTheme(isDark ? 'light' : 'dark');
    });
  }
  // Wire PDF button
  const pdfBtn = document.getElementById('export-pdf');
  if (pdfBtn) pdfBtn.addEventListener('click', exportPDF);

  // Wire botão limpar seleção
  const clearSel = document.getElementById('clear-selection');
  if (clearSel) {
    clearSel.addEventListener('click', () => {
      state.selectedIds.clear();
      renderTable();
      renderStats();
    });
  }

  // Wire botões de expandir/recolher (aplica para qualquer .collapse-toggle com data-target)
  document.querySelectorAll('.collapse-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;
      const isCollapsed = target.classList.toggle('collapsed');
      const icon = btn.querySelector('i');
      const label = btn.querySelector('span');
      if (icon) {
        icon.classList.toggle('fa-chevron-up', !isCollapsed);
        icon.classList.toggle('fa-chevron-down', isCollapsed);
      }
      if (label) label.textContent = isCollapsed ? 'Expandir' : 'Recolher';
    });
  });
});
