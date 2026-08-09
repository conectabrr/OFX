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
  reversalOnlyMode: false,  // Botão exclusivo: mostra apenas transações de estorno
  sourceFormat: 'OFX',      // Formato do arquivo importado (OFX / Excel / ...)
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

    // Detalhes do estorno: destinatário original e motivo
    let reversalReason = '';
    let reversalRecipient = '';
    if (isReversal) {
      reversalReason = detectReversalReason(memo, name, correctFitId);
      // Destinatário original = a pessoa/empresa a quem a transação corrigida
      // foi enviada. Para estornos, o counterpartyName atual já é o destinatário
      // original (o dinheiro está voltando dele). Se não temos, tentamos
      // extrair do MEMO padrões brasileiros.
      reversalRecipient = counterparty.name || extractReversalRecipient(memo, name);
    }

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
      reversalReason,                          // ex: "Estorno", "Devolução", "Reembolso"
      reversalRecipient,                       // Nome do destinatário original do débito
      correctFitId,                            // FITID da transação sendo corrigida
      correctAction,                           // REPLACE | DELETE (se OFX estruturado)
    });
  }

  // Pós-processamento: para cada estorno com correctFitId, tenta resolver o
  // nome do destinatário original olhando a transação corrigida.
  const byId = new Map(transactions.map((t) => [t.id, t]));
  transactions.forEach((t) => {
    if (t.isReversal && t.correctFitId) {
      const original = byId.get(t.correctFitId);
      if (original) {
        // Se o estorno ainda não tem destinatário, herda do original
        if (!t.reversalRecipient) {
          t.reversalRecipient = original.counterpartyName || original.counterparty || '';
        }
        // Guarda referências úteis
        t.reversalOriginalDate = original.date;
        t.reversalOriginalAmount = original.amount;
        t.reversalOriginalDescription = original.description;
      }
    }
  });

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
  const text = `${memo} ${name}`.toUpperCase();
  // Detecção por palavras-chave tem prioridade sobre "correção genérica"
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
  if (correctFitId) return 'Correção (OFX)';
  return 'Estorno';
}

/**
 * Extrai o nome do destinatário original de um estorno a partir do MEMO/NAME.
 * Padrões brasileiros típicos:
 *  - "ESTORNO IFOOD PEDIDO ALMOÇO"       → IFOOD
 *  - "DEVOLUÇÃO COMPRA CANCELADA MAGAZINE" → MAGAZINE
 *  - "REEMBOLSO NETFLIX ASSINATURA"      → NETFLIX
 *  - "ESTORNO PIX ENVIADO PARA JOAO"     → JOAO
 */
function extractReversalRecipient(memo, name) {
  const source = `${memo} ${name}`.trim();
  if (!source) return '';

  // Stop-words que NÃO são o destinatário — pulamos ao capturar
  const STOP = new Set([
    'PIX', 'TED', 'DOC', 'TRANSF', 'TRANSFERENCIA', 'TRANSFERÊNCIA',
    'PAGAMENTO', 'PAGTO', 'PGTO', 'COMPRA', 'COMPRAS', 'DEBITO', 'DÉBITO',
    'CREDITO', 'CRÉDITO', 'ENVIADO', 'ENVIADA', 'RECEBIDO', 'RECEBIDA',
    'EFETUADO', 'EFETUADA', 'CANCELADO', 'CANCELADA', 'CANCELADAS', 'CANCELADOS',
    'PEDIDO', 'PEDIDOS', 'ASSINATURA', 'MENSALIDADE',
    'PARA', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'A', 'AO', 'AOS', 'AS', 'À', 'ÀS',
    'CANCEL', 'CANCELAMENTO',
  ]);

  // Tenta patterns específicos com preposição explícita primeiro
  const strong = [
    // "ESTORNO ... PARA <NOME>"
    /(?:ESTORNO|DEVOLU[ÇC][ÃA]O|REEMBOLSO|CANCELAMENTO|CHARGEBACK|RESSARCIMENTO|REVERS[AÃ]O)\s+(?:[A-ZÀ-Ú]+\s+)*?PARA\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9\s.&'-]{2,60}?)(?=\s+(?:PEDIDO|COMPRA|ASSINATURA|CPF|CNPJ|AG\.|CC\.|BCO|BANCO|-|$))/i,
    // "ESTORNO ... DE <NOME>"
    /(?:ESTORNO|DEVOLU[ÇC][ÃA]O|REEMBOLSO)\s+(?:[A-ZÀ-Ú]+\s+)*?DE\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9\s.&'-]{2,60}?)(?=\s+(?:PEDIDO|COMPRA|ASSINATURA|CPF|CNPJ|AG\.|CC\.|BCO|BANCO|-|$))/i,
  ];
  for (const re of strong) {
    const m = source.match(re);
    if (m && m[1]) return m[1].trim().replace(/\s+/g, ' ');
  }

  // Fallback: pega a primeira palavra "significativa" após a keyword de estorno,
  // pulando stop-words. Ex.: "DEVOLUCAO COMPRA CANCELADA MAGAZINE" → MAGAZINE
  const kwRe = /(?:ESTORNO|DEVOLU[ÇC][ÃA]O|REEMBOLSO|CANCELAMENTO|CHARGEBACK|RESSARCIMENTO|REVERS[AÃ]O|DEVOLVID[OA])\b/i;
  const kwMatch = source.match(kwRe);
  if (kwMatch) {
    const rest = source.substring(kwMatch.index + kwMatch[0].length).trim();
    const tokens = rest.split(/\s+/);
    const picked = [];
    for (const tok of tokens) {
      const t = tok.replace(/[.,;:!?]$/, '').toUpperCase();
      if (!t) continue;
      if (STOP.has(t)) {
        // Se já começamos a coletar e batemos numa stop-word, paramos
        if (picked.length > 0) break;
        continue;
      }
      // Ignora números puros (valores, códigos, CPF)
      if (/^\d+[\d.,/-]*$/.test(t)) {
        if (picked.length > 0) break;
        continue;
      }
      picked.push(tok.replace(/[.,;:!?]$/, ''));
      if (picked.length >= 4) break; // limite pra evitar pegar descrição toda
    }
    if (picked.length > 0) return picked.join(' ').trim();
  }

  return '';
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
  const isOFX = ext === 'ofx';
  const isExcel = ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'xlsb';

  if (!isOFX && !isExcel) {
    showError('Formato não suportado. Use .ofx, .xlsx ou .xls');
    return;
  }

  if (isExcel) {
    handleExcelFile(file);
    return;
  }

  // OFX: lemos como ArrayBuffer para detectar o encoding correto
  // (o OFX declara ENCODING e CHARSET no cabeçalho)
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const buffer = e.target.result;
      const encoding = detectOFXEncoding(buffer);
      const decoder = new TextDecoder(encoding, { fatal: false });
      const content = decoder.decode(buffer);
      const { accountInfo, transactions } = parseOFX(content);
      finalizeImport(accountInfo, transactions, 'OFX');
    } catch (err) {
      console.error(err);
      showError('Erro ao processar arquivo: ' + err.message);
    }
  };
  reader.onerror = () => showError('Não foi possível ler o arquivo.');
  reader.readAsArrayBuffer(file);
}

/**
 * Finaliza a importação de qualquer formato (OFX/Excel/etc): atualiza o estado
 * e alterna para o dashboard.
 */
function finalizeImport(accountInfo, transactions, sourceFormat) {
  if (!transactions || transactions.length === 0) {
    showError('Nenhuma transação foi encontrada no arquivo.');
    return;
  }
  state.accountInfo = accountInfo;
  state.transactions = transactions;
  state.filtered = [...transactions];
  state.sourceFormat = sourceFormat || 'OFX';
  renderDashboard();
  uploadSection.classList.add('hidden');
  dashboard.classList.remove('hidden');
  // Mostra botão de "Novo arquivo" no header
  resetBtn.classList.remove('hidden');
  resetBtn.classList.add('inline-flex');
}

/* ============================================================================
   EXCEL PARSER — SheetJS (window.XLSX)
   ============================================================================
   Fluxo:
   1. Ler arquivo como ArrayBuffer
   2. XLSX.read() → workbook com sheets
   3. Para cada sheet, tentar detectar linha de cabeçalho + colunas por keywords
   4. Se auto-detect suceder → importar direto
   5. Senão → abrir modal de mapeamento manual
   ============================================================================ */

// Estado temporário para o modal de mapeamento
const excelState = {
  workbook: null,
  fileName: '',
  sheetName: '',
  headerRow: 1, // 1-indexed conforme UI
  rows: [],    // array de arrays (raw AOA)
  headers: [], // cabeçalhos detectados
};

function handleExcelFile(file) {
  if (typeof XLSX === 'undefined') {
    showError('Biblioteca de leitura Excel não carregou. Recarregue a página.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const buffer = e.target.result;
      const workbook = XLSX.read(buffer, {
        type: 'array',
        cellDates: true,
        cellNF: false,
        cellText: false,
      });
      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        showError('Arquivo Excel vazio ou inválido.');
        return;
      }
      excelState.workbook = workbook;
      excelState.fileName = file.name;

      // Tenta auto-detectar em cada sheet
      const detected = autoDetectExcelBankFormat(workbook);
      if (detected && detected.transactions.length > 0) {
        finalizeImport(detected.accountInfo, detected.transactions, 'Excel');
        return;
      }

      // Fallback: abre modal de mapeamento manual
      openExcelMappingModal(workbook.SheetNames[0]);
    } catch (err) {
      console.error(err);
      showError('Erro ao processar Excel: ' + err.message);
    }
  };
  reader.onerror = () => showError('Não foi possível ler o arquivo Excel.');
  reader.readAsArrayBuffer(file);
}

/**
 * Tenta detectar automaticamente o layout de extrato em qualquer sheet do workbook.
 * Retorna { accountInfo, transactions } se conseguir, ou null caso contrário.
 */
function autoDetectExcelBankFormat(workbook) {
  const KEYWORDS = {
    date: ['data', 'data mov', 'data movimento', 'data lanc', 'data lancamento', 'dt', 'dt.', 'dt mov', 'lancamento', 'lançamento'],
    description: ['descric', 'descrição', 'historico', 'histórico', 'descricao', 'lancamento', 'lançamento', 'memo', 'detalhe', 'complemento', 'observacao', 'observação'],
    amount: ['valor', 'valor r$', 'vlr', 'montante', 'importancia', 'importância'],
    credit: ['credito', 'crédito', 'entrada', 'entradas', 'depos', 'depósito', 'deposito', 'receitas'],
    debit: ['debito', 'débito', 'saida', 'saída', 'saidas', 'saídas', 'saque', 'pagamento', 'despesa'],
    balance: ['saldo', 'saldo r$', 'saldo atual', 'saldo em conta'],
    document: ['doc', 'documento', 'numero doc', 'número doc', 'nº doc', 'referencia', 'referência', 'fitid', 'txid', 'nº operação', 'nº operacao'],
    trntype: ['tipo', 'tp', 'operacao', 'operação', 'natureza'],
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // AOA: array de arrays; cada linha é um array de células
    // raw:true retorna números puros (não strings formatadas) — essencial para valores monetários
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    if (!aoa || aoa.length < 2) continue;

    // Procura linha de cabeçalho: varre as primeiras 20 linhas em busca de aquela
    // que tem mais matches de keywords
    let bestHeaderRow = -1;
    let bestScore = 0;
    let bestMapping = null;
    const maxScan = Math.min(20, aoa.length);

    for (let r = 0; r < maxScan; r++) {
      const row = aoa[r];
      if (!row || row.length < 2) continue;
      const mapping = matchColumns(row, KEYWORDS);
      const score = countMappingHits(mapping);
      if (score > bestScore) {
        bestScore = score;
        bestHeaderRow = r;
        bestMapping = mapping;
      }
    }

    // Consideramos válido apenas se tiver pelo menos: data + (valor OU crédito+débito) + descrição
    if (bestHeaderRow < 0 || !bestMapping) continue;
    const hasDate = bestMapping.date >= 0;
    const hasDesc = bestMapping.description >= 0;
    const hasAmount = bestMapping.amount >= 0 || (bestMapping.credit >= 0 && bestMapping.debit >= 0);
    if (!hasDate || !hasDesc || !hasAmount) continue;

    // Extrai transações a partir da linha seguinte
    const transactions = buildTransactionsFromAOA(aoa, bestHeaderRow, bestMapping);
    if (transactions.length === 0) continue;

    const accountInfo = buildExcelAccountInfo(transactions, workbook, sheetName);
    return { accountInfo, transactions, sheetName, headerRow: bestHeaderRow };
  }

  return null;
}

/**
 * Retorna um objeto de mapping { date, description, amount, credit, debit, balance, document, trntype }
 * com o índice da coluna correspondente (ou -1 se não encontrou).
 */
function matchColumns(headerRow, keywords) {
  const mapping = {
    date: -1, description: -1, amount: -1, credit: -1, debit: -1,
    balance: -1, document: -1, trntype: -1,
  };
  const norm = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normHeaders = headerRow.map(norm);

  for (const field of Object.keys(mapping)) {
    const kws = keywords[field].map(norm);
    let bestIdx = -1;
    let bestLen = 0;
    for (let i = 0; i < normHeaders.length; i++) {
      const cell = normHeaders[i];
      if (!cell) continue;
      for (const kw of kws) {
        // match: header contém keyword OU keyword contém header (para variações curtas)
        if (cell === kw || cell.startsWith(kw + ' ') || cell.endsWith(' ' + kw) || cell.includes(' ' + kw + ' ') || cell === kw) {
          if (kw.length > bestLen) {
            bestIdx = i;
            bestLen = kw.length;
          }
        } else if (cell.includes(kw) && kw.length >= 4) {
          // match parcial só para keywords maiores (evita "dt" matching qualquer coisa)
          if (kw.length > bestLen) {
            bestIdx = i;
            bestLen = kw.length;
          }
        }
      }
    }
    mapping[field] = bestIdx;
  }

  // Ambiguidade: se amount e credit apontam pra mesma coluna, priorize credit
  if (mapping.amount >= 0 && mapping.amount === mapping.credit) mapping.amount = -1;
  if (mapping.amount >= 0 && mapping.amount === mapping.debit) mapping.amount = -1;
  if (mapping.description >= 0 && mapping.description === mapping.date) mapping.description = -1;

  return mapping;
}

function countMappingHits(mapping) {
  let n = 0;
  for (const k of Object.keys(mapping)) if (mapping[k] >= 0) n++;
  return n;
}

/**
 * Constrói o array de transações a partir do AOA da planilha e do mapeamento de colunas.
 */
function buildTransactionsFromAOA(aoa, headerRow, mapping) {
  const transactions = [];
  let counter = 0;
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.length === 0) continue;

    // Pega valores
    const rawDate = mapping.date >= 0 ? row[mapping.date] : '';
    const rawDesc = mapping.description >= 0 ? row[mapping.description] : '';

    // Ignora linhas totalmente vazias, ou linhas de totalização (ex.: "SALDO ANTERIOR", "TOTAL")
    if (!rawDate && !rawDesc) continue;
    const descStr = String(rawDesc || '').trim();
    if (!descStr && !rawDate) continue;
    const descUpper = descStr.toUpperCase();
    if (/^(SALDO\s+(ANTERIOR|ATUAL|DO\s+DIA|BLOQUEADO)|TOTAL(\s+GERAL)?|SUBTOTAL)$/.test(descUpper)) continue;

    // Data
    const date = parseExcelDate(rawDate);
    if (!date) continue; // sem data válida, pula

    // Valor (com sinal) — parseBRNumber pode retornar null; coerce pra 0
    let amount = 0;
    if (mapping.amount >= 0) {
      amount = parseBRNumber(row[mapping.amount]) || 0;
    } else if (mapping.credit >= 0 || mapping.debit >= 0) {
      const cred = mapping.credit >= 0 ? Math.abs(parseBRNumber(row[mapping.credit]) || 0) : 0;
      const deb = mapping.debit >= 0 ? Math.abs(parseBRNumber(row[mapping.debit]) || 0) : 0;
      if (cred > 0) amount = cred;
      else if (deb > 0) amount = -deb;
    }

    if (!amount || amount === 0) {
      // linha sem valor → pula (provavelmente linha de saldo/subtotal)
      continue;
    }

    counter++;
    const id = 'XL' + counter + '_' + (Math.floor(date.getTime() / 1000));
    const doc = mapping.document >= 0 ? String(row[mapping.document] || '').trim() : '';
    const trnType = mapping.trntype >= 0 ? String(row[mapping.trntype] || '').trim().toUpperCase() : (amount >= 0 ? 'CREDIT' : 'DEBIT');
    const balanceRaw = mapping.balance >= 0 ? parseBRNumber(row[mapping.balance]) : null;
    const balance = (balanceRaw === null || isNaN(balanceRaw)) ? null : balanceRaw;

    const t = {
      id: id,
      date: date,
      type: amount >= 0 ? 'credit' : 'debit',
      trnType: trnType || (amount >= 0 ? 'CREDIT' : 'DEBIT'),
      description: descStr || (amount >= 0 ? 'Crédito' : 'Débito'),
      memo: descStr,
      name: '',
      document: doc,
      amount: amount,
      absAmount: Math.abs(amount),
      counterparty: '',
      counterpartyName: '',
      counterpartyAccount: '',
      counterpartyBank: '',
      counterpartyBranch: '',
      isReversal: false,
      reversalReason: '',
      correctFitId: '',
      correctAction: '',
      reversalRecipient: '',
      reversalOriginalDate: null,
      reversalOriginalAmount: null,
      reversalOriginalDescription: '',
      balanceBefore: null,
      balanceAfter: balance,
      _rawBalance: balance,
    };

    // Detecção heurística de estorno: só marca como estorno se detectReversalReason
    // achar um match de palavra-chave (não podemos passar correctFitId senão sempre retorna algo)
    const upperDesc = descStr.toUpperCase();
    const hasReversalKeyword = /ESTORNO|DEVOLU[ÇC][ÃA]O|DEVOLVID|REEMBOLSO|CANCELAMENTO|CANCELAD|CHARGEBACK|RESSARCIMENTO|REVERS[AÃ]O|REVERSAL/.test(upperDesc);
    if (hasReversalKeyword) {
      t.isReversal = true;
      t.reversalReason = detectReversalReason(descStr, '', '');
      t.reversalRecipient = extractReversalRecipient(descStr, '') || '';
    }

    // Extrai contraparte a partir da descrição (usa a mesma função do parser OFX,
    // passando bloco vazio para forçar fallback heurístico sobre MEMO/NAME)
    try {
      const cp = extractCounterparty('', descStr, '');
      if (cp) {
        t.counterparty = cp.label || '';
        t.counterpartyName = cp.name || '';
        t.counterpartyAccount = cp.account || '';
        t.counterpartyBank = cp.bank || '';
        t.counterpartyBranch = cp.branch || '';
      }
    } catch (e) { /* ignora falha na extração de contraparte */ }
    // Fallback: se não achou contraparte, use primeiras palavras da descrição como nome
    if (!t.counterpartyName && descStr) {
      const clean = descStr.replace(/^(PIX|TED|DOC|TRANSFERENCIA|TRANSFERÊNCIA|PAGAMENTO|COMPRA|SAQUE|DEPOSITO|DEPÓSITO|ESTORNO|DEVOLUCAO|DEVOLUÇÃO)\s+(ENVIADO|RECEBIDO|EFETUADO|EFETUADA|DE|PARA|A|AO|DA|DO)?\s*/i, '').trim();
      if (clean) {
        t.counterpartyName = clean.split(/\s+/).slice(0, 4).join(' ').substring(0, 60);
        t.counterparty = t.counterpartyName;
      }
    }

    transactions.push(t);
  }

  // Ordena por data crescente
  transactions.sort((a, b) => a.date - b.date);

  // Calcula balanceBefore/After quando temos o saldo em cada linha
  computeBalanceForExcelTransactions(transactions);

  return transactions;
}

/**
 * Se tivermos saldo em cada linha (balanceAfter conhecido), preencher balanceBefore.
 * Se não tivermos, deixa null (a UI já lida com isso).
 */
function computeBalanceForExcelTransactions(transactions) {
  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    if (t._rawBalance !== null && t._rawBalance !== undefined && !isNaN(t._rawBalance)) {
      t.balanceAfter = t._rawBalance;
      t.balanceBefore = t._rawBalance - t.amount;
    } else if (i > 0 && transactions[i - 1].balanceAfter !== null) {
      // encadeamento a partir do saldo da linha anterior
      t.balanceBefore = transactions[i - 1].balanceAfter;
      t.balanceAfter = t.balanceBefore + t.amount;
    }
    delete t._rawBalance;
  }
}

/**
 * Parse de data vinda de célula Excel. Aceita:
 *   - Date objects (quando cellDates:true funcionou)
 *   - Strings em formato BR (dd/mm/yyyy, dd/mm/yy, dd-mm-yyyy)
 *   - Strings em formato ISO (yyyy-mm-dd)
 *   - Números serial do Excel
 */
function parseExcelDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value;
  }
  // Número serial do Excel (dias desde 1900-01-01)
  if (typeof value === 'number' && isFinite(value) && value > 0) {
    // Converte serial Excel → JS Date (offset de 25569 dias do Unix + bug do ano 1900)
    const utcDays = Math.floor(value - 25569);
    const utcSecs = Math.round((value - 25569 - utcDays) * 86400);
    const d = new Date(utcDays * 86400 * 1000 + utcSecs * 1000);
    if (isNaN(d.getTime())) return null;
    return d;
  }
  const s = String(value).trim();
  if (!s) return null;

  // dd/mm/yyyy ou dd/mm/yy
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let day = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    const hh = m[4] ? parseInt(m[4], 10) : 0;
    const mm = m[5] ? parseInt(m[5], 10) : 0;
    const ss = m[6] ? parseInt(m[6], 10) : 0;
    const d = new Date(year, month - 1, day, hh, mm, ss);
    if (!isNaN(d.getTime())) return d;
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      m[4] ? parseInt(m[4], 10) : 0,
      m[5] ? parseInt(m[5], 10) : 0,
      m[6] ? parseInt(m[6], 10) : 0
    );
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: Date.parse
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

/**
 * Constrói accountInfo sintético a partir das transações Excel.
 * Excel geralmente não tem cabeçalho estruturado com banco/agência/conta.
 * Tenta descobrir a partir do nome do arquivo ou nome da aba.
 */
function buildExcelAccountInfo(transactions, workbook, sheetName) {
  const dates = transactions.map(t => t.date).filter(d => d instanceof Date);
  const startDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
  const endDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;
  // Saldo final: usa último balanceAfter conhecido, ou soma cumulativa
  let balance = 0;
  const last = transactions[transactions.length - 1];
  if (last && last.balanceAfter !== null && last.balanceAfter !== undefined) {
    balance = last.balanceAfter;
  } else {
    balance = transactions.reduce((acc, t) => acc + t.amount, 0);
  }

  return {
    bankId: '',
    branchId: '',
    accountId: sheetName || '',
    accountType: 'CHECKING',
    currency: 'BRL',
    startDate: startDate,
    endDate: endDate,
    balance: balance,
    balanceDate: endDate,
    source: 'Excel: ' + (excelState.fileName || 'planilha'),
  };
}

/* ---------------- Modal de mapeamento manual ---------------- */

function openExcelMappingModal(defaultSheet) {
  const modal = document.getElementById('excel-mapping-modal');
  if (!modal) {
    showError('Modal de mapeamento não encontrado.');
    return;
  }
  const workbook = excelState.workbook;

  // Popula sheets
  const sheetSelect = document.getElementById('excel-sheet-select');
  sheetSelect.innerHTML = '';
  workbook.SheetNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sheetSelect.appendChild(opt);
  });
  sheetSelect.value = defaultSheet || workbook.SheetNames[0];

  // Reset header row
  document.getElementById('excel-header-row').value = '1';

  refreshExcelMappingUI();

  modal.classList.remove('hidden');
  document.getElementById('excel-mapping-subtitle').textContent =
    'Não foi possível detectar automaticamente. Selecione as colunas manualmente.';

  // ESC handler
  const escHandler = (e) => {
    if (e.key === 'Escape') closeExcelMappingModal();
  };
  document.addEventListener('keydown', escHandler);
  modal._escHandler = escHandler;
}

function closeExcelMappingModal() {
  const modal = document.getElementById('excel-mapping-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  if (modal._escHandler) {
    document.removeEventListener('keydown', modal._escHandler);
    modal._escHandler = null;
  }
}

/**
 * Lê os dados da aba selecionada + linha de cabeçalho configurada,
 * popula os dropdowns de mapeamento e a prévia.
 */
function refreshExcelMappingUI() {
  const sheetName = document.getElementById('excel-sheet-select').value;
  const headerRow = Math.max(1, parseInt(document.getElementById('excel-header-row').value, 10) || 1);
  excelState.sheetName = sheetName;
  excelState.headerRow = headerRow;

  const sheet = excelState.workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  excelState.rows = aoa;

  const headerIdx = headerRow - 1;
  const headers = (aoa[headerIdx] || []).map((h, i) => {
    const letter = XLSX.utils.encode_col(i);
    const label = String(h || '').trim() || '(vazio)';
    return { idx: i, label: label + ' [' + letter + ']' };
  });
  excelState.headers = headers;

  // Tenta auto-detect para pré-selecionar os dropdowns
  const KEYWORDS = {
    date: ['data', 'data mov', 'data movimento', 'data lanc', 'data lancamento', 'dt', 'dt.', 'dt mov', 'lancamento', 'lançamento'],
    description: ['descric', 'descrição', 'historico', 'histórico', 'descricao', 'lancamento', 'lançamento', 'memo', 'detalhe', 'complemento', 'observacao', 'observação'],
    amount: ['valor', 'valor r$', 'vlr', 'montante'],
    credit: ['credito', 'crédito', 'entrada', 'entradas'],
    debit: ['debito', 'débito', 'saida', 'saída', 'saidas', 'saídas'],
    balance: ['saldo', 'saldo r$', 'saldo atual'],
    document: ['doc', 'documento', 'referencia', 'referência', 'fitid', 'txid'],
    trntype: ['tipo', 'tp', 'operacao', 'operação', 'natureza'],
  };
  const detected = matchColumns(aoa[headerIdx] || [], KEYWORDS);

  const fields = ['date', 'description', 'amount', 'credit', 'debit', 'balance', 'document', 'trntype'];
  fields.forEach(f => {
    const sel = document.getElementById('map-col-' + f);
    sel.innerHTML = '<option value="-1">— (não usar) —</option>';
    headers.forEach(h => {
      const opt = document.createElement('option');
      opt.value = String(h.idx);
      opt.textContent = h.label;
      sel.appendChild(opt);
    });
    sel.value = String(detected[f] !== undefined ? detected[f] : -1);
  });

  // Contadores
  document.getElementById('excel-rows-count').textContent = String(Math.max(0, aoa.length - headerRow));
  document.getElementById('excel-cols-count').textContent = String(headers.length);

  // Prévia (10 primeiras linhas de dados)
  renderExcelPreview(aoa, headerIdx);
}

function renderExcelPreview(aoa, headerIdx) {
  const body = document.getElementById('excel-preview-body');
  if (!body) return;
  const headers = aoa[headerIdx] || [];
  const dataRows = aoa.slice(headerIdx + 1, headerIdx + 11);
  const maxCols = Math.max(headers.length, ...dataRows.map(r => (r || []).length));

  let html = '<div class="overflow-x-auto rounded border border-gray-200 dark:border-slate-700"><table class="min-w-full text-xs"><thead class="bg-gray-100 dark:bg-slate-900 sticky top-0"><tr>';
  html += '<th class="px-2 py-1 text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">#</th>';
  for (let c = 0; c < maxCols; c++) {
    const letter = XLSX.utils.encode_col(c);
    const label = String(headers[c] || '').trim() || '(vazio)';
    html += '<th class="px-2 py-1 text-left text-gray-700 dark:text-slate-200 border-b border-gray-200 dark:border-slate-700 whitespace-nowrap"><span class="text-[10px] text-gray-400 dark:text-slate-500">[' + letter + ']</span> ' + escapeHtml(label) + '</th>';
  }
  html += '</tr></thead><tbody>';
  dataRows.forEach((row, idx) => {
    html += '<tr class="' + (idx % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-gray-50 dark:bg-slate-900/40') + '">';
    html += '<td class="px-2 py-1 text-gray-400 dark:text-slate-500">' + (headerIdx + 2 + idx) + '</td>';
    for (let c = 0; c < maxCols; c++) {
      const val = (row || [])[c];
      html += '<td class="px-2 py-1 text-gray-700 dark:text-slate-300 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis" title="' + escapeHtml(String(val || '')) + '">' + escapeHtml(String(val || '')) + '</td>';
    }
    html += '</tr>';
  });
  if (aoa.length > headerIdx + 11) {
    html += '<tr><td colspan="' + (maxCols + 1) + '" class="px-2 py-2 text-center text-xs text-gray-400 dark:text-slate-500 italic">... e mais ' + (aoa.length - headerIdx - 11) + ' linhas</td></tr>';
  }
  html += '</tbody></table></div>';
  body.innerHTML = html;
}

function confirmExcelMapping() {
  const mapping = {
    date: parseInt(document.getElementById('map-col-date').value, 10),
    description: parseInt(document.getElementById('map-col-description').value, 10),
    amount: parseInt(document.getElementById('map-col-amount').value, 10),
    credit: parseInt(document.getElementById('map-col-credit').value, 10),
    debit: parseInt(document.getElementById('map-col-debit').value, 10),
    balance: parseInt(document.getElementById('map-col-balance').value, 10),
    document: parseInt(document.getElementById('map-col-document').value, 10),
    trntype: parseInt(document.getElementById('map-col-trntype').value, 10),
  };

  // Validação
  if (mapping.date < 0) {
    alert('Selecione a coluna de Data');
    return;
  }
  if (mapping.description < 0) {
    alert('Selecione a coluna de Descrição / Histórico');
    return;
  }
  if (mapping.amount < 0 && (mapping.credit < 0 && mapping.debit < 0)) {
    alert('Selecione uma coluna de Valor OU as colunas de Crédito e Débito');
    return;
  }

  const headerIdx = excelState.headerRow - 1;
  const transactions = buildTransactionsFromAOA(excelState.rows, headerIdx, mapping);
  if (transactions.length === 0) {
    alert('Nenhuma transação válida foi encontrada com esse mapeamento. Verifique os campos selecionados.');
    return;
  }

  const accountInfo = buildExcelAccountInfo(transactions, excelState.workbook, excelState.sheetName);
  closeExcelMappingModal();
  finalizeImport(accountInfo, transactions, 'Excel');
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
  const cpToggle = document.getElementById('counterparty-reversal-toggle');
  const cpBadge = document.getElementById('counterparty-reversal-badge');
  const total = state.transactions.filter((t) => t.isReversal).length;
  if (countEl) countEl.textContent = String(total);
  if (cpBadge) cpBadge.textContent = String(total);
  if (wrapper) {
    if (total > 0) wrapper.classList.remove('hidden');
    else wrapper.classList.add('hidden');
  }
  // Botão exclusivo de estorno no painel de contrapartes
  if (cpToggle) {
    if (total > 0) {
      cpToggle.classList.remove('hidden');
      cpToggle.classList.add('flex');
    } else {
      cpToggle.classList.add('hidden');
      cpToggle.classList.remove('flex');
    }
    // Sincroniza estado visual (active) com state.reversalOnlyMode
    if (state.reversalOnlyMode) {
      cpToggle.classList.add('active');
      cpToggle.setAttribute('aria-pressed', 'true');
    } else {
      cpToggle.classList.remove('active');
      cpToggle.setAttribute('aria-pressed', 'false');
    }
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
  const reversalOnly = state.reversalOnlyMode;

  // Filtra a lista pela tipagem selecionada.
  // Se o modo "apenas estornos" está ativo, mostra somente contrapartes que TÊM estornos.
  let scoped = (state.counterpartyList || []).filter(([, data]) => {
    if (reversalOnly) return data.reversalCount > 0;
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
    const emptyMsg = reversalOnly
      ? 'Nenhum estorno neste extrato.'
      : 'Nenhuma contraparte encontrada para este tipo.';
    panel.innerHTML = `<p class="text-xs text-slate-400 italic p-2 col-span-full">${emptyMsg}</p>`;
    if (countLabel) countLabel.textContent = '';
    return;
  }
  if (countLabel) {
    const total = state.counterpartyList.length;
    const shown = scoped.length;
    if (reversalOnly) {
      countLabel.textContent = `(${shown} com estornos)`;
    } else {
      countLabel.textContent =
        typeFilter === 'all' ? `(${total})` : `(${shown} de ${total})`;
    }
  }

  const currentFilter = filterCounterparty.value.trim().toLowerCase();
  panel.innerHTML = scoped
    .map(([name, data]) => {
      const isActive = currentFilter && name.toLowerCase() === currentFilter;
      const activeClass = isActive
        ? 'bg-blue-100 dark:bg-blue-900 border-blue-400 dark:border-blue-500 text-blue-800 dark:text-blue-200'
        : 'bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200';
      const flows = [];
      // Modo "somente estornos": mostra apenas o total de estornos
      if (reversalOnly) {
        if (data.reversalCount > 0) {
          flows.push(
            `<span class="text-amber-600 dark:text-amber-400" title="Estornos/devoluções"><i class="fas fa-undo"></i> ${formatCurrency(
              data.totalReversal
            )}</span>`
          );
        }
      } else {
        // Modo normal: mostra créditos e/ou débitos conforme o filtro de tipo
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
        // Sempre mostra o badge de estornos quando existir (independente do tipo)
        if (data.reversalCount > 0) {
          flows.push(
            `<span class="text-amber-600 dark:text-amber-400" title="Estornos/devoluções"><i class="fas fa-undo"></i> ${data.reversalCount} · ${formatCurrency(
              data.totalReversal
            )}</span>`
          );
        }
      }
      const shownCount = reversalOnly
        ? data.reversalCount
        : typeFilter === 'credit'
          ? data.creditCount
          : typeFilter === 'debit'
          ? data.debitCount
          : data.count;
      // Badge de estorno sempre visível quando há estornos
      const reversalBadge =
        data.reversalCount > 0
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
  // Passthrough: se já é number válido (do Excel raw), retorna direto
  if (typeof str === 'number') return isFinite(str) ? str : null;
  let s = String(str).trim();
  if (!s) return null;
  // Remove símbolos de moeda e espaços
  s = s.replace(/R\$|\s/g, '').replace(/[^\d,.\-+]/g, '');
  if (!s) return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Ambos presentes: precisa decidir se é BR (5.000,00) ou US (5,000.00)
    // Regra: qual dos dois aparece por último é o SEPARADOR DECIMAL
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      // BR: vírgula é decimal, ponto é milhar
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US: ponto é decimal, vírgula é milhar
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Só vírgula: decimal BR (ou milhar US, mas sem decimal → tratamos como BR decimal)
    // Se a vírgula tem exatamente 3 dígitos depois e é única, é milhar US (ex.: "5,000")
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      // Ambíguo mas plausível como milhar US (5,000) — remove
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/,/g, '.');
    }
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

  // Filtro por estorno/devolução (dropdown do painel de filtros)
  const filterReversalEl = document.getElementById('filter-reversal');
  if (filterReversalEl) {
    const rvMode = filterReversalEl.value;
    if (rvMode === 'only') result = result.filter((t) => t.isReversal);
    else if (rvMode === 'exclude') result = result.filter((t) => !t.isReversal);
  }

  // Botão EXCLUSIVO de estorno (Contrapartes) - independente do filtro de tipo
  // Sobrepõe qualquer outro filtro: mostra APENAS estornos.
  if (state.reversalOnlyMode) {
    result = result.filter((t) => t.isReversal);
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
  const dash = '<span class="text-gray-300 dark:text-slate-600">-</span>';
  tbody.innerHTML = pageItems
    .map((t) => {
      const badgeClass = t.type === 'credit' ? 'badge-credit' : 'badge-debit';
      const valueClass = t.type === 'credit' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
      const sign = t.type === 'credit' ? '+' : '-';
      const cpLabel = t.type === 'credit' ? 'De' : 'Para';
      const cpDisplay = t.counterparty
        ? `<span class="text-gray-400 dark:text-slate-500 mr-1">${cpLabel}:</span>${escapeHtml(t.counterparty)}`
        : dash;
      const reversalBadge = t.isReversal
        ? `<span class="badge badge-reversal ml-1" title="${escapeHtml(t.reversalReason || 'Estorno')}"><i class="fas fa-undo mr-1"></i>${escapeHtml(t.reversalReason || 'Estorno')}</span>`
        : '';
      const isSelected = state.selectedIds.has(t.id);
      const rowClass = isSelected
        ? 'bg-blue-50 dark:bg-blue-900/20'
        : (t.isReversal ? 'bg-amber-50/40 dark:bg-amber-900/10' : '');
      const balBefore = t.balanceBefore != null
        ? `<span class="text-gray-600 dark:text-slate-300">${formatCurrency(t.balanceBefore)}</span>`
        : dash;
      const balAfter = t.balanceAfter != null
        ? `<span class="${t.balanceAfter >= 0 ? 'text-gray-800 dark:text-slate-100 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}">${formatCurrency(t.balanceAfter)}</span>`
        : dash;
      // Colunas exclusivas de estorno
      const reversalReasonCell = t.isReversal
        ? `<span class="badge badge-reversal"><i class="fas fa-undo mr-1"></i>${escapeHtml(t.reversalReason || 'Estorno')}</span>`
        : dash;
      const reversalRecipientCell = t.isReversal && t.reversalRecipient
        ? `<span class="text-amber-800 dark:text-amber-200 font-medium" title="Destinatário original do débito estornado">${escapeHtml(t.reversalRecipient)}</span>`
        : (t.isReversal ? '<span class="text-gray-400 dark:text-slate-500 italic text-xs">Não identificado</span>' : dash);
      const correctFitCell = t.isReversal && t.correctFitId
        ? `<span class="text-xs text-amber-700 dark:text-amber-300 font-mono" title="FITID da transação original corrigida">${escapeHtml(t.correctFitId)}</span>`
        : dash;
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
          <td class="px-3 py-3 text-xs whitespace-nowrap">${reversalReasonCell}</td>
          <td class="px-3 py-3 text-sm">${reversalRecipientCell}</td>
          <td class="px-3 py-3 text-xs">${correctFitCell}</td>
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
        // Bloco extra de detalhes do estorno (mobile)
        const reversalDetails = t.isReversal
          ? `<div class="mt-1 p-2 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800 text-[11px] space-y-0.5">
               <div class="text-amber-800 dark:text-amber-200 font-semibold">
                 <i class="fas fa-undo mr-1"></i>${escapeHtml(t.reversalReason || 'Estorno')}
               </div>
               ${t.reversalRecipient ? `<div class="text-amber-700 dark:text-amber-300"><span class="text-amber-600 dark:text-amber-400">Destinatário:</span> ${escapeHtml(t.reversalRecipient)}</div>` : ''}
               ${t.correctFitId ? `<div class="text-amber-700 dark:text-amber-300 font-mono"><span class="text-amber-600 dark:text-amber-400 font-sans">FITID Original:</span> ${escapeHtml(t.correctFitId)}</div>` : ''}
             </div>`
          : '';
        const cardBaseClass = t.isReversal && !isSelected ? 'bg-amber-50/30 dark:bg-amber-900/5' : '';
        return `
          <div class="p-3 space-y-1 ${cardClass || cardBaseClass}">
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
            ${reversalDetails}
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
// EXPORTAÇÃO - MODAL DE PRÉVIA
// ============================================================
/**
 * Colunas exportadas em CSV/PDF. Centralizadas para consistência entre
 * a prévia do modal e o arquivo final.
 */
const EXPORT_COLUMNS = [
  'Data/Hora',
  'Tipo',
  'Descrição',
  'Conta Destino/Origem',
  'Motivo Estorno',
  'Destinatário Estorno',
  'FITID Original',
  'TxId',
  'Valor',
  'Saldo Antes',
  'Saldo Após',
];

/** Monta uma linha de exportação a partir de uma transação */
function buildExportRow(t) {
  return [
    formatDateTime(t.date),
    getTrnTypeLabel(t.trnType) + (t.isReversal ? ' (Estorno)' : ''),
    t.description || '',
    t.counterparty || '',
    t.isReversal ? (t.reversalReason || 'Estorno') : '',
    t.isReversal ? (t.reversalRecipient || '') : '',
    t.isReversal ? (t.correctFitId || '') : '',
    t.id || '',
    (t.type === 'credit' ? '+' : '-') + ' ' + formatCurrency(t.absAmount),
    t.balanceBefore != null ? formatCurrency(t.balanceBefore) : '',
    t.balanceAfter != null ? formatCurrency(t.balanceAfter) : '',
  ];
}

/** Retorna a fonte de dados para exportação: seleção OU tudo que está filtrado */
function getExportSource() {
  return state.selectedIds.size > 0
    ? state.filtered.filter((t) => state.selectedIds.has(t.id))
    : state.filtered;
}

/**
 * Abre o modal de prévia da exportação.
 * @param {string} format - 'pdf' ou 'csv'
 */
function openExportPreview(format) {
  const source = getExportSource();
  if (source.length === 0) {
    alert('Nenhuma transação para exportar. Ajuste os filtros ou selecione ao menos uma linha.');
    return;
  }

  const modal = document.getElementById('export-preview-modal');
  const title = document.getElementById('export-modal-title');
  const subtitle = document.getElementById('export-modal-subtitle');
  const icon = document.getElementById('export-modal-icon');
  const confirmLabel = document.getElementById('export-modal-confirm-label');
  const confirmBtn = document.getElementById('export-modal-confirm');
  const hint = document.getElementById('preview-footer-hint');

  // Configura visual conforme formato
  if (format === 'pdf') {
    title.textContent = 'Prévia — Relatório PDF';
    subtitle.textContent = 'Confira o conteúdo antes de gerar o arquivo PDF';
    icon.className = 'fas fa-file-pdf text-2xl';
    confirmLabel.textContent = 'Gerar PDF';
    confirmBtn.className =
      'px-4 py-2 rounded-lg text-sm font-semibold text-white transition bg-red-600 hover:bg-red-700';
    hint.textContent = 'O PDF será baixado após confirmar. Layout otimizado A4 paisagem.';
  } else {
    title.textContent = 'Prévia — Planilha CSV';
    subtitle.textContent = 'Confira o conteúdo antes de gerar o arquivo CSV';
    icon.className = 'fas fa-file-csv text-2xl';
    confirmLabel.textContent = 'Baixar CSV';
    confirmBtn.className =
      'px-4 py-2 rounded-lg text-sm font-semibold text-white transition bg-green-600 hover:bg-green-700';
    hint.textContent = 'CSV separado por ponto-e-vírgula com BOM UTF-8 (Excel-compatível).';
  }

  // Metadados
  const credits = source.filter((t) => t.type === 'credit');
  const debits = source.filter((t) => t.type === 'debit');
  const totalCredit = credits.reduce((s, t) => s + t.amount, 0);
  const totalDebit = debits.reduce((s, t) => s + t.absAmount, 0);
  const balance = totalCredit - totalDebit;
  const reversalCount = source.filter((t) => t.isReversal).length;

  document.getElementById('preview-meta-count').textContent =
    `${source.length} ${reversalCount > 0 ? `(${reversalCount} estornos)` : ''}`;
  document.getElementById('preview-meta-credits').textContent =
    `${formatCurrency(totalCredit)} · ${credits.length}`;
  document.getElementById('preview-meta-debits').textContent =
    `${formatCurrency(totalDebit)} · ${debits.length}`;
  const balanceEl = document.getElementById('preview-meta-balance');
  balanceEl.textContent = formatCurrency(balance);
  balanceEl.className =
    'font-bold ' + (balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400');

  // Corpo: tabela com prévia (mostra até 50 primeiras linhas)
  const previewBody = document.getElementById('preview-body');
  const previewLimit = 50;
  const preview = source.slice(0, previewLimit);
  const overflow = source.length - preview.length;

  const info = state.accountInfo;
  const filtersApplied = collectAppliedFilters();

  const filtersHtml = filtersApplied.length
    ? `<div class="mb-3 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs">
         <div class="font-semibold text-blue-800 dark:text-blue-200 mb-1"><i class="fas fa-filter mr-1"></i>Filtros aplicados</div>
         <div class="text-blue-700 dark:text-blue-300">${filtersApplied.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>
       </div>`
    : '';

  const accountHtml = `
    <div class="mb-3 p-3 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-lg text-xs grid grid-cols-2 sm:grid-cols-3 gap-2">
      <div><span class="text-gray-500 dark:text-slate-400">Banco:</span> <strong class="text-gray-800 dark:text-slate-100">${escapeHtml(info.bankId || '-')}</strong></div>
      <div><span class="text-gray-500 dark:text-slate-400">Agência:</span> <strong class="text-gray-800 dark:text-slate-100">${escapeHtml(info.branchId || '-')}</strong></div>
      <div><span class="text-gray-500 dark:text-slate-400">Conta:</span> <strong class="text-gray-800 dark:text-slate-100">${escapeHtml(info.accountId || '-')}</strong></div>
      <div><span class="text-gray-500 dark:text-slate-400">Período:</span> <strong class="text-gray-800 dark:text-slate-100">${formatDate(info.startDate)} → ${formatDate(info.endDate)}</strong></div>
      <div><span class="text-gray-500 dark:text-slate-400">Saldo:</span> <strong class="text-indigo-600 dark:text-indigo-400">${formatCurrency(info.balance)}</strong></div>
      <div><span class="text-gray-500 dark:text-slate-400">Gerado em:</span> <strong class="text-gray-800 dark:text-slate-100">${new Date().toLocaleString('pt-BR')}</strong></div>
    </div>
  `;

  const tableRows = preview
    .map((t) => {
      const row = buildExportRow(t);
      const cls = t.isReversal ? 'reversal-row' : '';
      const valueColor = t.type === 'credit'
        ? 'color:#16a34a;font-weight:600'
        : 'color:#dc2626;font-weight:600';
      return `<tr class="${cls}">
        ${row
          .map((cell, i) => {
            const style = i === 8 ? `style="${valueColor};white-space:nowrap"` : '';
            const nowrap = (i === 0 || i === 9 || i === 10) ? 'style="white-space:nowrap"' : '';
            return `<td ${style || nowrap}>${escapeHtml(String(cell))}</td>`;
          })
          .join('')}
      </tr>`;
    })
    .join('');

  const overflowNotice = overflow > 0
    ? `<div class="mt-2 p-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-800 dark:text-amber-200 text-center">
         <i class="fas fa-info-circle mr-1"></i>
         Prévia exibindo as primeiras <strong>${previewLimit}</strong> linhas. O arquivo exportado conterá <strong>todas as ${source.length}</strong> transações.
       </div>`
    : '';

  previewBody.innerHTML = `
    ${accountHtml}
    ${filtersHtml}
    <div class="overflow-auto border border-gray-200 dark:border-slate-700 rounded-lg" style="max-height:50vh">
      <table>
        <thead>
          <tr>${EXPORT_COLUMNS.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${overflowNotice}
  `;

  // Configura ação do botão de confirmar
  confirmBtn.onclick = () => {
    closeExportPreview();
    if (format === 'pdf') doExportPDF();
    else doExportCSV();
  };

  modal.classList.remove('hidden');
  // Foco no botão de fechar (acessibilidade)
  document.getElementById('export-modal-close').focus();
}

function closeExportPreview() {
  const modal = document.getElementById('export-preview-modal');
  if (modal) modal.classList.add('hidden');
}

/** Retorna lista legível de filtros aplicados atualmente */
function collectAppliedFilters() {
  const list = [];
  if (filterType.value !== 'all') {
    list.push(`Tipo: ${filterType.value === 'credit' ? 'Somente créditos' : 'Somente débitos'}`);
  }
  if (filterStart.value) list.push(`De: ${new Date(filterStart.value).toLocaleString('pt-BR')}`);
  if (filterEnd.value) list.push(`Até: ${new Date(filterEnd.value).toLocaleString('pt-BR')}`);
  if (filterSearch.value) list.push(`Busca: "${filterSearch.value}"`);
  if (filterCounterparty.value) list.push(`Conta: ${filterCounterparty.value}`);
  if (filterMin.value) list.push(`Mín: ${filterMin.value}`);
  if (filterMax.value) list.push(`Máx: ${filterMax.value}`);
  const reversalEl = document.getElementById('filter-reversal');
  if (reversalEl && reversalEl.value === 'only') list.push('Somente estornos');
  if (reversalEl && reversalEl.value === 'exclude') list.push('Sem estornos');
  if (state.reversalOnlyMode) list.push('Botão exclusivo: apenas estornos');
  if (state.selectedIds.size > 0) list.push(`Seleção manual: ${state.selectedIds.size} linha(s)`);
  return list;
}

// ============================================================
// EXPORTAÇÃO CSV — abre modal de prévia
// ============================================================
function exportCSV() {
  openExportPreview('csv');
}

/** Executa a exportação CSV de fato (chamado pelo modal) */
function doExportCSV() {
  const source = getExportSource();
  if (source.length === 0) return;

  // Para CSV: valores numéricos em formato BR (com vírgula) mas sem prefixo +/-
  // (já temos coluna "Tipo" para indicar crédito/débito).
  const rows = source.map((t) => [
    formatDateTime(t.date),
    getTrnTypeLabel(t.trnType) + (t.isReversal ? ' (Estorno)' : ''),
    (t.description || '').replace(/"/g, '""'),
    (t.counterparty || '').replace(/"/g, '""'),
    t.isReversal ? (t.reversalReason || 'Estorno') : '',
    t.isReversal ? (t.reversalRecipient || '').replace(/"/g, '""') : '',
    t.isReversal ? (t.correctFitId || '') : '',
    t.id || '',
    t.amount.toFixed(2).replace('.', ','),
    t.balanceBefore != null ? t.balanceBefore.toFixed(2).replace('.', ',') : '',
    t.balanceAfter != null ? t.balanceAfter.toFixed(2).replace('.', ',') : '',
  ]);

  const csv = [
    EXPORT_COLUMNS.join(';'),
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
// EXPORTAÇÃO PDF — abre modal de prévia
// ============================================================
function exportPDF() {
  openExportPreview('pdf');
}

/**
 * Executa a exportação PDF de fato (chamado pelo modal).
 * Layout profissional com:
 *  - Cabeçalho colorido com título e logo textual
 *  - Bloco de informações da conta
 *  - Bloco de filtros aplicados
 *  - Painel de resumo estatístico com cards coloridos
 *  - Tabela de transações com destaque de estornos
 *  - Rodapé com paginação e marca d'água
 */
function doExportPDF() {
  const source = getExportSource();
  if (source.length === 0) return;
  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
    alert('Biblioteca de PDF não carregada. Recarregue a página e tente novamente.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const info = state.accountInfo;
  const margin = 12;

  // Paleta de cores profissional (RGB)
  const COL = {
    primary: [30, 58, 138],        // indigo-900
    primaryLight: [67, 97, 238],   // indigo-500
    accent: [37, 99, 235],         // blue-600
    green: [22, 163, 74],
    red: [220, 38, 38],
    amber: [217, 119, 6],
    slate900: [15, 23, 42],
    slate700: [51, 65, 85],
    slate500: [100, 116, 139],
    slate400: [148, 163, 184],
    slate100: [241, 245, 249],
    slate50: [248, 250, 252],
    white: [255, 255, 255],
    reversalBg: [254, 243, 199],   // amber-100
  };

  // ==========================================================================
  // CABEÇALHO PROFISSIONAL (banner colorido)
  // ==========================================================================
  const headerH = 24;
  doc.setFillColor(...COL.primary);
  doc.rect(0, 0, pageWidth, headerH, 'F');
  // Faixa mais clara para dar profundidade
  doc.setFillColor(...COL.primaryLight);
  doc.rect(0, headerH - 3, pageWidth, 3, 'F');

  // Título
  doc.setTextColor(...COL.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Relatório de Extrato Bancário', margin, 12);

  // Subtítulo
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(219, 234, 254); // blue-100
  doc.text('Análise detalhada de transações · Processado localmente', margin, 18);

  // Data à direita
  doc.setFontSize(9);
  doc.setTextColor(...COL.white);
  const genDate = new Date().toLocaleString('pt-BR');
  doc.text(`Gerado em: ${genDate}`, pageWidth - margin, 12, { align: 'right' });
  doc.setFontSize(7);
  doc.setTextColor(219, 234, 254);
  doc.text('Leitor OFX', pageWidth - margin, 18, { align: 'right' });

  // ==========================================================================
  // INFO DA CONTA - card com borda
  // ==========================================================================
  let y = headerH + 6;
  const cardH = 20;
  doc.setDrawColor(...COL.slate400);
  doc.setLineWidth(0.2);
  doc.setFillColor(...COL.slate50);
  doc.roundedRect(margin, y, pageWidth - 2 * margin, cardH, 1.5, 1.5, 'FD');

  doc.setTextColor(...COL.slate700);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMAÇÕES DA CONTA', margin + 3, y + 4);

  // Grid de 4 colunas
  const cols = [
    { label: 'Banco', value: info.bankId || '-' },
    { label: 'Agência', value: info.branchId || '-' },
    { label: 'Conta', value: `${info.accountId || '-'} (${getAccountTypeLabel(info.accountType)})` },
    { label: 'Período', value: `${formatDate(info.startDate)} → ${formatDate(info.endDate)}` },
    { label: 'Saldo em ' + formatDate(info.balanceDate), value: formatCurrency(info.balance) },
    { label: 'Moeda', value: info.currency || 'BRL' },
    { label: 'Total no extrato', value: `${state.transactions.length} transações` },
    { label: 'No relatório', value: `${source.length} transações` },
  ];
  const colWidth = (pageWidth - 2 * margin - 6) / 4;
  cols.forEach((c, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const cx = margin + 3 + col * colWidth;
    const cy = y + 9 + row * 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COL.slate500);
    doc.text(c.label.toUpperCase(), cx, cy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COL.slate900);
    const truncated = doc.splitTextToSize(String(c.value), colWidth - 2)[0];
    doc.text(truncated, cx, cy + 3.5);
  });
  y += cardH + 4;

  // ==========================================================================
  // FILTROS APLICADOS (se houver)
  // ==========================================================================
  const filters = collectAppliedFilters();
  if (filters.length > 0) {
    const filtersText = filters.join('  ·  ');
    const wrapped = doc.splitTextToSize(filtersText, pageWidth - 2 * margin - 22);
    const filterH = 6 + wrapped.length * 3.5;
    doc.setFillColor(239, 246, 255); // blue-50
    doc.setDrawColor(191, 219, 254); // blue-200
    doc.roundedRect(margin, y, pageWidth - 2 * margin, filterH, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COL.accent);
    doc.text('FILTROS APLICADOS', margin + 3, y + 3.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COL.slate700);
    doc.text(wrapped, margin + 3, y + 7);
    y += filterH + 3;
  }

  // ==========================================================================
  // RESUMO ESTATÍSTICO - 5 cards
  // ==========================================================================
  const credits = source.filter((t) => t.type === 'credit');
  const debits = source.filter((t) => t.type === 'debit');
  const totalCredit = credits.reduce((s, t) => s + t.amount, 0);
  const totalDebit = debits.reduce((s, t) => s + t.absAmount, 0);
  const balance = totalCredit - totalDebit;
  const reversalCount = source.filter((t) => t.isReversal).length;
  const totalReversal = source
    .filter((t) => t.isReversal)
    .reduce((s, t) => s + t.absAmount, 0);

  const summaryCards = [
    { label: 'Transações', value: String(source.length), color: COL.slate700, accent: COL.accent },
    { label: 'Créditos', value: formatCurrency(totalCredit), sub: `${credits.length} entradas`, color: COL.green, accent: COL.green },
    { label: 'Débitos', value: formatCurrency(totalDebit), sub: `${debits.length} saídas`, color: COL.red, accent: COL.red },
    { label: 'Saldo do Período', value: formatCurrency(balance), color: balance >= 0 ? COL.green : COL.red, accent: COL.primary },
  ];
  if (reversalCount > 0) {
    summaryCards.push({
      label: 'Estornos',
      value: formatCurrency(totalReversal),
      sub: `${reversalCount} operações`,
      color: COL.amber,
      accent: COL.amber,
    });
  }

  const cardH2 = 14;
  const cardW = (pageWidth - 2 * margin - (summaryCards.length - 1) * 2) / summaryCards.length;
  summaryCards.forEach((c, i) => {
    const cx = margin + i * (cardW + 2);
    // Fundo branco com borda
    doc.setFillColor(...COL.white);
    doc.setDrawColor(...COL.slate400);
    doc.roundedRect(cx, y, cardW, cardH2, 1, 1, 'FD');
    // Barra colorida esquerda
    doc.setFillColor(...c.accent);
    doc.rect(cx, y, 1.2, cardH2, 'F');
    // Label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...COL.slate500);
    doc.text(c.label.toUpperCase(), cx + 3, y + 3.5);
    // Valor
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...c.color);
    const valueText = doc.splitTextToSize(c.value, cardW - 4)[0];
    doc.text(valueText, cx + 3, y + 8.5);
    // Sub
    if (c.sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(...COL.slate400);
      doc.text(c.sub, cx + 3, y + 12);
    }
  });
  y += cardH2 + 5;

  // ==========================================================================
  // TÍTULO DA TABELA
  // ==========================================================================
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COL.slate900);
  const scopeLabel = state.selectedIds.size > 0 ? 'Transações Selecionadas' : 'Detalhamento das Transações';
  doc.text(scopeLabel, margin, y);
  // Linha separadora
  doc.setDrawColor(...COL.primary);
  doc.setLineWidth(0.4);
  doc.line(margin, y + 1.5, pageWidth - margin, y + 1.5);
  y += 4;

  // ==========================================================================
  // TABELA DE TRANSAÇÕES
  // ==========================================================================
  // Headers e rows com colunas de estorno
  const head = [[
    'Data/Hora', 'Tipo', 'Descrição', 'Contraparte',
    'Motivo Estorno', 'Destinatário', 'FITID Orig.',
    'TxId', 'Valor', 'Saldo Antes', 'Saldo Após'
  ]];
  const rows = source.map((t) => [
    formatDateTime(t.date),
    getTrnTypeLabel(t.trnType) + (t.isReversal ? ' *' : ''),
    t.description || '',
    t.counterparty || '-',
    t.isReversal ? (t.reversalReason || 'Estorno') : '',
    t.isReversal ? (t.reversalRecipient || '') : '',
    t.isReversal ? (t.correctFitId || '') : '',
    t.id || '-',
    (t.type === 'credit' ? '+' : '-') + ' ' + formatCurrency(t.absAmount),
    t.balanceBefore != null ? formatCurrency(t.balanceBefore) : '-',
    t.balanceAfter != null ? formatCurrency(t.balanceAfter) : '-',
  ]);

  doc.autoTable({
    startY: y,
    head,
    body: rows,
    margin: { left: margin, right: margin, bottom: 14 },
    styles: {
      fontSize: 6,
      cellPadding: 1.2,
      overflow: 'linebreak',
      lineColor: COL.slate400,
      lineWidth: 0.05,
      textColor: COL.slate900,
    },
    headStyles: {
      fillColor: COL.primary,
      textColor: COL.white,
      fontStyle: 'bold',
      fontSize: 6.5,
      halign: 'left',
      cellPadding: 1.8,
      lineColor: COL.primary,
    },
    alternateRowStyles: { fillColor: COL.slate50 },
    columnStyles: {
      0: { cellWidth: 22 },                        // Data
      1: { cellWidth: 18 },                        // Tipo
      2: { cellWidth: 'auto' },                    // Descrição
      3: { cellWidth: 32 },                        // Contraparte
      4: { cellWidth: 18 },                        // Motivo Estorno
      5: { cellWidth: 26 },                        // Destinatário
      6: { cellWidth: 20, font: 'courier', fontSize: 5.5 }, // FITID Original
      7: { cellWidth: 20, font: 'courier', fontSize: 5.5 }, // TxId
      8: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }, // Valor
      9: { cellWidth: 20, halign: 'right' },       // Saldo Antes
      10: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }, // Saldo Após
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const t = source[data.row.index];
      // Estornos: fundo amber suave em toda a linha
      if (t && t.isReversal) {
        data.cell.styles.fillColor = COL.reversalBg;
      }
      // Coluna VALOR: verde ou vermelho
      if (data.column.index === 8) {
        data.cell.styles.textColor = t.amount >= 0 ? COL.green : COL.red;
      }
      // Saldo após negativo: vermelho
      if (data.column.index === 10 && t.balanceAfter != null && t.balanceAfter < 0) {
        data.cell.styles.textColor = COL.red;
      }
      // Motivo Estorno: amber
      if (data.column.index === 4 && t.isReversal) {
        data.cell.styles.textColor = COL.amber;
        data.cell.styles.fontStyle = 'bold';
      }
      // Destinatário Estorno: amber escuro
      if (data.column.index === 5 && t.isReversal && t.reversalRecipient) {
        data.cell.styles.textColor = [146, 64, 14]; // amber-800
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: (data) => {
      // Repete o cabeçalho colorido em cada página (mais profissional)
      if (data.pageNumber > 1) {
        doc.setFillColor(...COL.primary);
        doc.rect(0, 0, pageWidth, 10, 'F');
        doc.setTextColor(...COL.white);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Relatório de Extrato Bancário', margin, 6.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(genDate, pageWidth - margin, 6.5, { align: 'right' });
      }
      // Rodapé com paginação
      const pageCount = doc.internal.getNumberOfPages();
      doc.setDrawColor(...COL.slate400);
      doc.setLineWidth(0.2);
      doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);
      doc.setFontSize(7);
      doc.setTextColor(...COL.slate500);
      doc.setFont('helvetica', 'normal');
      doc.text('Leitor OFX · Processado 100% localmente no navegador', margin, pageHeight - 6);
      doc.setFont('helvetica', 'bold');
      doc.text(
        `Página ${data.pageNumber} de ${pageCount}`,
        pageWidth - margin,
        pageHeight - 6,
        { align: 'right' }
      );
    },
  });

  // ==========================================================================
  // TOTAL FINAL - card destacado
  // ==========================================================================
  let endY = doc.lastAutoTable.finalY + 4;
  const totalCardH = 12;
  if (endY + totalCardH > pageHeight - 15) {
    doc.addPage();
    endY = 15;
  }
  const totalCardW = 90;
  const totalCardX = pageWidth - margin - totalCardW;
  const totalColor = balance >= 0 ? COL.green : COL.red;
  doc.setFillColor(...COL.slate900);
  doc.roundedRect(totalCardX, endY, totalCardW, totalCardH, 1.5, 1.5, 'F');
  // Barra colorida à esquerda
  doc.setFillColor(...totalColor);
  doc.rect(totalCardX, endY, 2, totalCardH, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COL.slate400);
  const totalLabel = state.selectedIds.size > 0
    ? `TOTAL DA SELEÇÃO (${source.length})`
    : `TOTAL FILTRADO (${source.length} transações)`;
  doc.text(totalLabel, totalCardX + 4, endY + 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...(balance >= 0 ? [34, 197, 94] : [248, 113, 113]));
  doc.text(formatCurrency(balance), totalCardX + totalCardW - 3, endY + 9, { align: 'right' });

  // ==========================================================================
  // LEGENDA (se houver estornos)
  // ==========================================================================
  if (reversalCount > 0) {
    let legY = endY + totalCardH + 4;
    if (legY > pageHeight - 15) {
      doc.addPage();
      legY = 15;
    }
    doc.setFillColor(...COL.reversalBg);
    doc.rect(margin, legY, 4, 4, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COL.slate500);
    doc.text(
      'Linhas em destaque amarelo indicam transações de estorno/devolução. O asterisco (*) na coluna Tipo confirma o estorno.',
      margin + 6,
      legY + 3
    );
  }

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
  // Uso explícito de add/remove (em vez de toggle) para garantir consistência
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  try {
    localStorage.setItem('theme', theme);
  } catch (e) {
    console.warn('localStorage não disponível:', e);
  }
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

  // === Botão de tema (claro/escuro) ===
  // Usa event delegation para robustez: qualquer clique dentro do botão
  // (incluindo no ícone <i>) dispara a troca de tema.
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isDark = document.documentElement.classList.contains('dark');
      setTheme(isDark ? 'light' : 'dark');
    });
  }

  // === Botão de exportação PDF (abre modal de prévia) ===
  // Botão CSV é conectado em setupFilters() (após carregar OFX)
  const pdfBtn = document.getElementById('export-pdf');
  if (pdfBtn) pdfBtn.addEventListener('click', exportPDF);

  // === Modal de prévia: fechar/cancelar ===
  const modalClose = document.getElementById('export-modal-close');
  const modalCancel = document.getElementById('export-modal-cancel');
  if (modalClose) modalClose.addEventListener('click', closeExportPreview);
  if (modalCancel) modalCancel.addEventListener('click', closeExportPreview);
  // Clique no backdrop (fora do card) fecha o modal
  const modal = document.getElementById('export-preview-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeExportPreview();
    });
  }
  // ESC fecha o modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeExportPreview();
    }
  });

  // === Botão exclusivo de estorno no painel de Contrapartes ===
  const cpReversalBtn = document.getElementById('counterparty-reversal-toggle');
  if (cpReversalBtn) {
    cpReversalBtn.addEventListener('click', () => {
      state.reversalOnlyMode = !state.reversalOnlyMode;
      updateReversalUI();
      state.currentPage = 1;
      applyFilters();
    });
  }

  // === Botão limpar seleção ===
  const clearSel = document.getElementById('clear-selection');
  if (clearSel) {
    clearSel.addEventListener('click', () => {
      state.selectedIds.clear();
      renderTable();
      renderStats();
    });
  }

  // === Botões colapsáveis ===
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

  // === Modal de mapeamento de colunas do Excel ===
  const excelMappingModal = document.getElementById('excel-mapping-modal');
  const excelMappingClose = document.getElementById('excel-mapping-close');
  const excelMappingCancel = document.getElementById('excel-mapping-cancel');
  const excelMappingConfirm = document.getElementById('excel-mapping-confirm');
  const excelSheetSelect = document.getElementById('excel-sheet-select');
  const excelHeaderRow = document.getElementById('excel-header-row');

  if (excelMappingClose) excelMappingClose.addEventListener('click', closeExcelMappingModal);
  if (excelMappingCancel) excelMappingCancel.addEventListener('click', closeExcelMappingModal);
  if (excelMappingConfirm) excelMappingConfirm.addEventListener('click', confirmExcelMapping);
  if (excelMappingModal) {
    excelMappingModal.addEventListener('click', (e) => {
      if (e.target === excelMappingModal) closeExcelMappingModal();
    });
  }
  if (excelSheetSelect) excelSheetSelect.addEventListener('change', refreshExcelMappingUI);
  if (excelHeaderRow) excelHeaderRow.addEventListener('change', refreshExcelMappingUI);
});
