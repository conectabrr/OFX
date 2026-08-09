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
};

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
      counterparty: counterparty.label,       // Ex: "JOÃO SILVA" ou "AG 1234 CC 56789-0"
      counterpartyAccount: counterparty.account, // Ex: "56789-0"
      counterpartyBank: counterparty.bank,       // Ex: "001"
      counterpartyBranch: counterparty.branch,   // Ex: "1234"
      counterpartyName: counterparty.name,       // Ex: "JOÃO SILVA"
    });
  }

  if (transactions.length === 0) {
    throw new Error(
      'Nenhuma transação encontrada no arquivo. Verifique se o OFX está no formato correto.'
    );
  }

  return { accountInfo, transactions };
}

function getTagValue(text, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)<\/${tag}>`, 'i');
  const m = text.match(regex);
  return m ? m[1].trim() : '';
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
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }
  dashboard.classList.add('hidden');
  uploadSection.classList.remove('hidden');
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

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;
      const { accountInfo, transactions } = parseOFX(content);
      state.accountInfo = accountInfo;
      state.transactions = transactions;
      state.filtered = [...transactions];
      renderDashboard();
      uploadSection.classList.add('hidden');
      dashboard.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showError('Erro ao processar arquivo: ' + err.message);
    }
  };
  reader.onerror = () => showError('Não foi possível ler o arquivo.');
  // Bancos brasileiros costumam usar ISO-8859-1 (Latin1) - tentamos primeiro UTF-8
  reader.readAsText(file, 'ISO-8859-1');
}

// ============================================================
// RENDERIZAÇÃO
// ============================================================
function renderDashboard() {
  renderAccountInfo();
  setupFilters();
  applyFilters();
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
      <div class="bg-gray-50 rounded-lg p-3">
        <div class="text-xs text-gray-500 uppercase font-semibold">
          <i class="fas ${item.icon} mr-1"></i>${item.label}
        </div>
        <div class="text-sm font-semibold text-gray-800 mt-1 break-words">${item.value}</div>
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
    // Ao alterar filtros, sempre volta para página 1
    const handler = () => {
      state.currentPage = 1;
      applyFilters();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
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

/** Popula o datalist do autocomplete de contraparte com valores únicos */
function populateCounterpartyList() {
  const set = new Set();
  state.transactions.forEach((t) => {
    if (t.counterpartyName) set.add(t.counterpartyName);
    if (t.counterpartyAccount) set.add(t.counterpartyAccount);
    if (t.counterparty) set.add(t.counterparty);
  });
  counterpartyList.innerHTML = [...set]
    .sort()
    .map((v) => `<option value="${escapeHtml(v)}"></option>`)
    .join('');
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

  // Filtro por descrição (case-insensitive)
  const searchTerm = filterSearch.value.trim().toLowerCase();
  if (searchTerm) {
    result = result.filter(
      (t) =>
        t.description.toLowerCase().includes(searchTerm) ||
        (t.memo && t.memo.toLowerCase().includes(searchTerm)) ||
        (t.name && t.name.toLowerCase().includes(searchTerm))
    );
  }

  // Filtro por conta destino/origem (contraparte)
  const cpTerm = filterCounterparty.value.trim().toLowerCase();
  if (cpTerm) {
    result = result.filter((t) => {
      return (
        (t.counterparty && t.counterparty.toLowerCase().includes(cpTerm)) ||
        (t.counterpartyName && t.counterpartyName.toLowerCase().includes(cpTerm)) ||
        (t.counterpartyAccount && t.counterpartyAccount.toLowerCase().includes(cpTerm)) ||
        (t.counterpartyBank && t.counterpartyBank.toLowerCase().includes(cpTerm)) ||
        (t.counterpartyBranch && t.counterpartyBranch.toLowerCase().includes(cpTerm))
      );
    });
  }

  // Filtro por valor
  const minV = parseFloat(filterMin.value);
  const maxV = parseFloat(filterMax.value);
  if (!isNaN(minV)) result = result.filter((t) => t.absAmount >= minV);
  if (!isNaN(maxV)) result = result.filter((t) => t.absAmount <= maxV);

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
  renderTable();
  renderStats();
  renderChart();
}

// ============================================================
// TABELA
// ============================================================
function renderTable() {
  const tbody = document.getElementById('transactions-tbody');
  const emptyState = document.getElementById('empty-state');
  const filteredCount = document.getElementById('filtered-count');
  const filteredTotal = document.getElementById('filtered-total');
  const pagination = document.getElementById('pagination');

  filteredCount.textContent = `(${state.filtered.length} de ${state.transactions.length})`;

  if (state.filtered.length === 0) {
    tbody.innerHTML = '';
    emptyState.classList.remove('hidden');
    pagination.classList.add('hidden');
    filteredTotal.textContent = formatCurrency(0);
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

  tbody.innerHTML = pageItems
    .map((t) => {
      const badgeClass = t.type === 'credit' ? 'badge-credit' : 'badge-debit';
      const valueClass = t.type === 'credit' ? 'text-green-600' : 'text-red-600';
      const sign = t.type === 'credit' ? '+' : '-';
      const cpLabel = t.type === 'credit' ? 'De' : 'Para';
      const cpDisplay = t.counterparty
        ? `<span class="text-gray-400 mr-1">${cpLabel}:</span>${escapeHtml(t.counterparty)}`
        : '<span class="text-gray-300">-</span>';
      return `
        <tr>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${formatDateTime(t.date)}</td>
          <td class="px-4 py-3 whitespace-nowrap">
            <span class="badge ${badgeClass}">
              <i class="fas fa-${t.type === 'credit' ? 'arrow-up' : 'arrow-down'} mr-1"></i>
              ${getTrnTypeLabel(t.trnType)}
            </span>
          </td>
          <td class="px-4 py-3 text-sm text-gray-800 max-w-md">${escapeHtml(t.description)}</td>
          <td class="px-4 py-3 text-sm text-gray-700">${cpDisplay}</td>
          <td class="px-4 py-3 text-xs text-gray-500 font-mono">${escapeHtml(t.document || '-')}</td>
          <td class="px-4 py-3 text-sm font-semibold text-right whitespace-nowrap ${valueClass}">
            ${sign} ${formatCurrency(t.absAmount)}
          </td>
        </tr>
      `;
    })
    .join('');

  // Total filtrado = soma algébrica de TODOS os itens filtrados (não só da página)
  const totalValue = state.filtered.reduce((sum, t) => sum + t.amount, 0);
  filteredTotal.textContent = formatCurrency(totalValue);
  filteredTotal.className =
    'px-4 py-3 text-right font-bold ' +
    (totalValue >= 0 ? 'text-green-600' : 'text-red-600');

  // Atualiza barra de paginação
  renderPagination(startIdx + 1, endIdx, total, pages);
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
  const credits = state.filtered.filter((t) => t.type === 'credit');
  const debits = state.filtered.filter((t) => t.type === 'debit');

  const totalCredit = credits.reduce((s, t) => s + t.amount, 0);
  const totalDebit = debits.reduce((s, t) => s + t.absAmount, 0);
  const balance = totalCredit - totalDebit;
  const avg =
    state.filtered.length > 0
      ? state.filtered.reduce((s, t) => s + t.absAmount, 0) / state.filtered.length
      : 0;

  document.getElementById('stat-count').textContent = state.filtered.length;
  document.getElementById('stat-credit').textContent = formatCurrency(totalCredit);
  document.getElementById('stat-credit-count').textContent = `${credits.length} entradas`;
  document.getElementById('stat-debit').textContent = formatCurrency(totalDebit);
  document.getElementById('stat-debit-count').textContent = `${debits.length} saídas`;
  const balanceEl = document.getElementById('stat-balance');
  balanceEl.textContent = formatCurrency(balance);
  balanceEl.className =
    'text-2xl font-bold mt-1 ' + (balance >= 0 ? 'text-indigo-600' : 'text-red-600');
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
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) =>
              new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
                maximumFractionDigits: 0,
              }).format(value),
          },
        },
      },
    },
  });
}

// ============================================================
// EXPORTAÇÃO CSV
// ============================================================
function exportCSV() {
  if (state.filtered.length === 0) {
    alert('Nenhuma transação para exportar.');
    return;
  }
  const headers = [
    'Data/Hora',
    'Tipo',
    'Descrição',
    'Conta Destino/Origem',
    'Documento',
    'Valor',
  ];
  const rows = state.filtered.map((t) => [
    formatDateTime(t.date),
    getTrnTypeLabel(t.trnType),
    t.description.replace(/"/g, '""'),
    (t.counterparty || '').replace(/"/g, '""'),
    t.document || '',
    t.amount.toFixed(2).replace('.', ','),
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
