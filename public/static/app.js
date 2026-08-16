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

  const calcDetail = document.getElementById('calc-detail');

  function calc() {
    const v = parseBRNumber(calcValue.value);
    const p = parseBRNumber(calcPercent.value);
    const op = calcOp.value;

    calcSecondLabel.textContent = labels[op];
    calcHint.textContent = hints[op];

    // Detalhe extra só faz sentido em ratio; oculta nos outros modos.
    if (calcDetail && op !== 'ratio') {
      calcDetail.classList.add('hidden');
      calcDetail.textContent = '';
    }

    if (v === null || p === null) {
      calcResult.textContent = op === 'ratio' ? '0,00%' : formatCurrency(0);
      if (calcDetail && op === 'ratio') {
        calcDetail.classList.add('hidden');
        calcDetail.textContent = '';
      }
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
        // "A é % de B" — mostra o percentual E os dois valores em R$
        // lado a lado, para o usuário visualizar melhor a proporção.
        if (p === 0) {
          display = '—';
          if (calcDetail) {
            calcDetail.classList.remove('hidden');
            calcDetail.innerHTML = `<span class="text-red-500">Valor de referência não pode ser R$ 0,00.</span>`;
          }
        } else {
          const pct = (v / p) * 100;
          display = pct.toFixed(2).replace('.', ',') + '%';
          if (calcDetail) {
            const diff = p - v;
            const diffLabel = diff >= 0 ? 'Falta para atingir B' : 'Ultrapassou B em';
            calcDetail.classList.remove('hidden');
            calcDetail.innerHTML = `
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><span class="text-gray-400">A:</span> <span class="font-semibold text-gray-700 dark:text-slate-200">${formatCurrency(v)}</span></div>
                <div><span class="text-gray-400">B:</span> <span class="font-semibold text-gray-700 dark:text-slate-200">${formatCurrency(p)}</span></div>
                <div><span class="text-gray-400">${diffLabel}:</span> <span class="font-semibold ${diff >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}">${formatCurrency(Math.abs(diff))}</span></div>
              </div>
            `;
          }
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

    // Detecção de boleto/título (multi-banco): TRNTYPE + keywords no MEMO/NAME
    const isBoleto = detectBoleto(trnType, memo, name, amount);
    const boletoReason = isBoleto ? detectBoletoReason(trnType, memo, name) : '';

    // Detecção de PIX: TRNTYPE contém PIX, OU memo/name contém "PIX"/"pix"
    // (usado para consolidar contrapartes por NOME em vez de por identificador)
    const isPix = detectPix(trnType, memo, name);

    // Descrição consolidada
    let description = name || memo;
    if (name && memo && name !== memo) {
      description = `${name} - ${memo}`;
    }
    if (!description) description = trnType;

    // Detalhes do estorno: destinatário original e motivo
    let reversalReason = '';
    // reversalRecipient = pessoa envolvida na transação ORIGINAL (não neste
    // estorno). Fica vazio nesta fase; o pós-processamento resolve via
    // lookup por CORRECTFITID ou por "Transação #NNNNN".
    let reversalRecipient = '';

    // ------------------------------------------------------------------
    // IDENTIFICADORES DA TRANSAÇÃO (o que aparece no comprovante):
    //
    // 1) TxId  = REFNUM do OFX
    //    É o identificador da instituição que aparece no comprovante do
    //    app do banco como "ID da transação" / "TxId". Exemplos reais
    //    vistos no arquivo InfoPago/Nubank:
    //       SE000372801790KKIKHDO4RAUII4PLGYLM
    //       CIELO202608020000000000000002074774
    //       mpqrinter171144758847
    //       LINX00008DEF7D13DD39E09X855D81CB4B6
    //       72ea7597dd33488f8e5b7093e9af64d2
    //
    // 2) EndToEndId (E2E) = padrão BACEN do PIX
    //    Formato: E<ISPB-8-dígitos><timestamp><random>, 32 caracteres,
    //    sempre começa com "E". Ex.: E82842386202608151811...
    //    Este campo NEM SEMPRE está no OFX (muitos bancos, incluindo
    //    Nubank/InfoPago, não exportam o E2E BACEN — o app o busca em
    //    outra API). Só é preenchido se encontrarmos o padrão em MEMO,
    //    NAME ou REFNUM.
    //
    // 3) "Transação #NNNNN" no MEMO
    //    É uma referência INTERNA do provedor OFX (ex: nº sequencial
    //    do processador InfoPago). NÃO é o TxId do comprovante — é só
    //    uma referência de correlação entre estorno e transação original.
    //    Guardamos apenas em `originalTxRef` para o lookup de estornos.
    // ------------------------------------------------------------------
    let originalTxRef = '';
    const txRefMatch = `${memo} ${name}`.match(/Transa[cç][aã]o\s*#\s*(\d{4,})/i);
    if (txRefMatch) originalTxRef = txRefMatch[1];
    if (isReversal) {
      reversalReason = detectReversalReason(memo, name, correctFitId);
    }

    // TxId final = REFNUM. Se não houver REFNUM, cai para FITID (que
    // pelo menos é único no arquivo). Nunca usa "#NNNNN" como TxId
    // (isso é referência interna, não o ID do comprovante).
    const txId = refNum || fitId || '';

    // EndToEnd = extrair padrão E\d{31,32} de qualquer campo textual.
    // Se o REFNUM já for um E2E (raro), aproveita. Senão, tenta MEMO/NAME.
    // Se nenhum campo tiver E2E, fica vazio (não temos como inventar).
    const E2E_REGEX = /\bE\d{31,32}\b/;
    let endToEnd = '';
    const e2eMatch = `${refNum} ${memo} ${name}`.match(E2E_REGEX);
    if (e2eMatch) endToEnd = e2eMatch[0];

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
      isBoleto,                                // boolean: é pagamento de boleto/título?
      boletoReason,                            // ex: "Boleto", "Título", "DDA", "Ticket"
      isPix,                                   // boolean: é transação PIX?
      // Identificadores da transação (o que aparece no comprovante):
      //  - txId    : REFNUM do OFX (o ID da instituição que aparece no
      //              comprovante como "TxId" / "ID da transação").
      //              Ex.: "SE00...", "CIELO...", "mpqrinter...", "LINX..."
      //              Fallback: FITID (dedup do OFX) quando REFNUM ausente.
      //  - endToEnd: EndToEndId BACEN (padrão E\d{31,32}). Só existe se
      //              o OFX exportar esse identificador em MEMO/NAME/REFNUM.
      //              Muitos bancos brasileiros (Nubank/InfoPago) NÃO
      //              exportam o E2E no OFX — o app do banco busca em API.
      txId,                                    // ID do comprovante (REFNUM || FITID)
      endToEnd,                                // EndToEndId BACEN (E\d{31,32}) ou vazio
      fitId,                                   // FITID do OFX (dedup/export)
      refNum,                                  // REFNUM cru (compat)
      // originalTxRef = número "#NNNNN" do MEMO, referência INTERNA
      // do provedor OFX. Usado APENAS para casar estorno⇄transação
      // original via byTxRef lookup. NUNCA mostrado como TxId (não é
      // o ID que aparece no comprovante do banco).
      originalTxRef,
      // Chave de agrupamento normalizada para o painel de "Movimentos".
      // PIX: usa APENAS o nome normalizado (sem identificadores únicos),
      // caso contrário mesmo destinatário aparece em cards separados por txId.
      // Não-PIX: usa o rótulo completo (nome + banco/ag/cc) como antes.
      movementKey: buildMovementKey(counterparty, isPix),
    });
  }

  // Pós-processamento: para cada estorno, tenta resolver a transação original
  // e o nome do destinatário/remetente original.
  //
  // Estratégia em cascata:
  //  1. CORRECTFITID (padrão OFX) → lookup direto pelo id
  //  2. originalTxRef ("Transação #NNNNN" do MEMO) → busca em MEMO/FITID de outras trans.
  //  3. Fallback: já preenchido em reversalRecipient (nome da contraparte atual)
  //
  // A transação original identificada:
  //  - Estorno de CRÉDITO (recebeu de volta): a original foi um débito que ele enviou
  //  - Devolução por DÉBITO (está devolvendo): a original foi um crédito que ele recebeu
  const byId = new Map(transactions.map((t) => [t.id, t]));
  // Índice reverso: número de transação (extraído do MEMO) → transação
  // ORIGINAL (não-estorno). Bancos como Nubank/Itaú colocam a MESMA
  // referência "Transação #NNNNN" tanto no débito original quanto no
  // estorno que o corrige — precisamos apontar para a original, não
  // para o próprio estorno (senão o lookup traz o nome do próprio card).
  //
  // Estratégia: só indexa transações NÃO-estorno. Se por acaso não
  // encontrarmos a original (extrato fragmentado), o campo fica vazio
  // e a UI mostra "Não identificado" — melhor que informação incorreta.
  const byTxRef = new Map();
  transactions.forEach((t) => {
    if (t.isReversal) return; // ignora estornos no índice
    const memoMatch = (t.memo || '').match(/Transa[cç][aã]o\s*#\s*(\d{4,})/i);
    if (memoMatch) {
      byTxRef.set(memoMatch[1], t);
    }
  });

  transactions.forEach((t) => {
    if (!t.isReversal) return;
    let original = null;
    // 1. Lookup por CORRECTFITID
    if (t.correctFitId) {
      original = byId.get(t.correctFitId);
    }
    // 2. Fallback: lookup por número de transação extraído do MEMO
    if (!original && t.originalTxRef) {
      original = byTxRef.get(t.originalTxRef);
    }

    if (original) {
      // Destinatário original vem SEMPRE do counterparty da transação
      // original — que é a pessoa/empresa que realmente estava do outro
      // lado do PIX (ex: para "Enviado para RODRIGO ... #50549206", quando
      // o estorno-crédito aparece com #50549206, o destinatário é RODRIGO).
      t.reversalRecipient =
        original.counterpartyName || original.counterparty || '';
      // Guarda referências úteis
      t.reversalOriginalDate = original.date;
      t.reversalOriginalAmount = original.amount;
      t.reversalOriginalDescription = original.description;
      t.reversalOriginalId = original.id;
      t.reversalOriginalType = original.type;
    }
    // Se NÃO conseguimos resolver a original, deixamos reversalRecipient
    // vazio — melhor mostrar "não identificado" do que informação errada.
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
 * Detecta se uma transação é pagamento de boleto/título bancário.
 *
 * Estratégia multi-camada (funciona em vários bancos brasileiros):
 *   1) TRNTYPE explícitos que sinalizam boleto:
 *        PAYMENT, DIRECTDEBIT, REPEATPMT
 *   2) Palavras-chave no MEMO/NAME (padrão da maioria dos bancos BR):
 *        BOLETO, TITULO/TÍTULO, COBRANCA/COBRANÇA, LIQUIDACAO/LIQUIDAÇÃO,
 *        FICHA DE COMPENSACAO, DDA (Débito Direto Autorizado),
 *        PAG BOLETO/PAGTO BOLETO/PGTO BOLETO/PAGAMENTO BOLETO,
 *        PAG ELETRONICO/PAGAMENTO ELETRONICO, CONVENIO (conta de consumo/tributo),
 *        e a keyword específica do InfoPago/InfinitePay: TICKET
 *   3) Descarta se for CRÉDITO puro sem contexto claro de boleto —
 *      boleto pago = débito por natureza. (Recebimento de boleto via PIX
 *      não é distinguível automaticamente e requer marcação manual.)
 */
function detectBoleto(trnType, memo, name, amount) {
  const t = (trnType || '').toUpperCase();
  const text = normalizeText(`${memo || ''} ${name || ''}`);

  // 1) TRNTYPE explícitos
  if (t === 'PAYMENT' || t === 'DIRECTDEBIT' || t === 'REPEATPMT') {
    return true;
  }

  // 2) Palavras-chave (sem acento, minúsculo — normalizeText já cuida disso)
  //    A ordem é do MAIS específico para o mais genérico para evitar falsos positivos.
  const keywords = [
    'boleto',
    'liquidacao boleto', 'liq boleto', 'liq. boleto',
    'pag boleto', 'pagto boleto', 'pgto boleto', 'pagamento boleto',
    'pag. boleto', 'pagto. boleto', 'pgto. boleto',
    'titulo bancario', 'titulo de cobranca',
    'ficha de compensacao', 'ficha compensacao',
    'dda',                             // Débito Direto Autorizado
    'pag eletronico', 'pagamento eletronico',
    'ticket',                          // InfoPago / InfinitePay usam "Ticket" para boletos pagos
    'convenio',                        // pagamento de convênio (concessionárias/tributos)
    'cobranca',                        // menos específico, vem por último
  ];

  const hit = keywords.some((kw) => text.includes(kw));
  if (!hit) return false;

  // 3) Filtro de segurança: se for crédito, só considera boleto quando
  //    a keyword é bem específica (evita marcar recebimento PIX comum).
  //    "Cobrança" sozinha em um crédito é ambígua.
  if (typeof amount === 'number' && amount > 0) {
    const strongCreditKw = /\b(boleto|titulo bancario|titulo de cobranca|ficha de compensacao|liquidacao boleto|pagamento eletronico)\b/;
    return strongCreditKw.test(text);
  }

  return true;
}

/**
 * Retorna um rótulo descritivo do tipo de boleto detectado, usado na UI.
 * Ex.: "Boleto", "Título", "DDA", "Convênio", "Ticket"
 */
function detectBoletoReason(trnType, memo, name) {
  const t = (trnType || '').toUpperCase();
  const text = normalizeText(`${memo || ''} ${name || ''}`);

  if (text.includes('dda')) return 'DDA';
  if (text.includes('convenio')) return 'Convênio';
  // "TICKET" no OFX (InfoPago/InfinitePay) é o mesmo que boleto —
  // troca aqui apenas para melhorar a identificação visual do usuário.
  if (/\bticket\b/.test(text)) return 'Boleto';
  if (text.includes('titulo')) return 'Título';
  if (text.includes('ficha de compensacao') || text.includes('ficha compensacao')) return 'Ficha Compensação';
  if (text.includes('boleto')) return 'Boleto';
  if (text.includes('cobranca')) return 'Cobrança';
  if (text.includes('pag eletronico') || text.includes('pagamento eletronico')) return 'Pagto Eletrônico';
  if (t === 'PAYMENT') return 'Boleto';
  if (t === 'DIRECTDEBIT') return 'Débito Automático';
  if (t === 'REPEATPMT') return 'Débito Automático';
  return 'Boleto';
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
  // Tenta capturar o "assunto" após a palavra-chave de estorno
  const patterns = [
    // "ESTORNO PIX ENVIADO PARA <NOME>" ou "ESTORNO PARA <NOME>"
    /(?:ESTORNO|DEVOLU[ÇC][ÃA]O|REEMBOLSO|CANCELAMENTO|CHARGEBACK|RESSARCIMENTO|REVERS[AÃ]O)\s+(?:PIX|TED|DOC|TRANSF(?:ERENCIA)?|PAGAMENTO|PAGTO|COMPRA|DEBITO)?\s*(?:ENVIADO|ENVIADA|CANCELAD[OA]|PARA|A|DE)?\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9\s.&'-]{2,60}?)(?=\s+(?:PEDIDO|COMPRA|ASSINATURA|CPF|CNPJ|AG\.|CC\.|BCO|BANCO|-|$))/i,
    // "ESTORNO <NOME>" seguido de descrição
    /(?:ESTORNO|DEVOLU[ÇC][ÃA]O|REEMBOLSO)\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9&.'-]{2,40})(?=\s|$)/i,
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (m && m[1]) {
      return m[1].trim().replace(/\s+/g, ' ');
    }
  }
  return '';
}

function getBlockValue(text, blockTag) {
  const regex = new RegExp(`<${blockTag}>([\\s\\S]*?)<\/${blockTag}>`, 'i');
  const m = text.match(regex);
  return m ? m[1] : '';
}

/**
 * Detecta se uma transação é PIX.
 * Bancos brasileiros indicam PIX de várias formas:
 *  - TRNTYPE contendo "PIX" (extensão comum de alguns bancos)
 *  - MEMO/NAME começa com "Pix", "PIX enviado", "PIX recebido", etc.
 *  - TxId de 32 hex é o "EndToEndId" do PIX
 */
function detectPix(trnType, memo, name) {
  if (trnType && /PIX/i.test(trnType)) return true;
  const text = normalizeText(`${memo} ${name}`);
  // Palavras-chave (sem acento, minúsculo)
  return /\bpix\b/.test(text);
}

/**
 * Constrói a chave de agrupamento usada no painel de "Movimentos".
 *
 * Para PIX, agrupamos por NOME apenas (normalizado), porque cada PIX
 * carrega um EndToEndId único que fragmentaria o mesmo destinatário
 * em vários cards. O usuário quer ver "João Silva" uma vez, não uma
 * vez por transação.
 *
 * Para não-PIX (TED, DOC, boleto, tarifa), usamos o rótulo completo
 * (nome + banco/ag/cc), pois ali a conta bancária é o dado relevante
 * para diferenciar movimentos.
 */
function buildMovementKey(counterparty, isPix) {
  if (isPix) {
    // PIX: usa nome normalizado (uppercase + trim + colapsa espaços).
    // Se não temos nome, cai no label mesmo (comportamento anterior).
    const rawName = (counterparty && counterparty.name) || '';
    const clean = rawName
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (clean) return clean;
    // Fallback: se não veio nome, usa o label. Se nem isso, retorna vazio.
    return (counterparty && counterparty.label) || '';
  }
  // Não-PIX: preserva label completo (nome · Bco X Ag Y Cc Z)
  return (
    (counterparty && counterparty.label) ||
    (counterparty && counterparty.name) ||
    ''
  );
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

  // 4. Nome extraído do memo: pega palavras após verbos comuns de transferência.
  //    Trata os padrões mais comuns em extratos brasileiros:
  //      "Enviado para NOME COMPLETO - ..."           (Itaú, Bradesco, Nubank PIX)
  //      "Recebido de NOME COMPLETO - ..."            (idem)
  //      "PIX/TED/DOC ENVIADO PARA NOME - ..."        (BB, Caixa)
  //      "TRANSFERENCIA RECEBIDA DE NOME"             (Santander)
  //      "PAGAMENTO A/PARA NOME"                      (boletos com favorecido)
  //    Aceita nomes em maiúsculas OU capitalizados (JEAN CARLO / Jean Carlo).
  if (!result.name) {
    const patterns = [
      // "Enviado para NOME" / "Recebido de NOME" — sem PIX antes (formato Itaú/Bradesco)
      /\b(?:ENVIAD[OA]|RECEBID[OA])\s+(?:PARA|DE|A)\s+([A-ZÀ-Úa-zà-ú][A-ZÀ-Úa-zà-ú\s.'-]{2,80}?)(?=\s+-\s|\s+(?:AG|CC|BCO|BANCO|CPF|CNPJ|TRANSA[CÇ][AÃ]O|#)|$)/i,
      // "PIX/TED/DOC/TRANSF ENVIADO/RECEBIDO PARA/DE/A NOME"
      /\b(?:PIX|TED|DOC|TRANSF(?:ERENCIA)?|PAGAMENTO|PAGTO)\s+(?:ENVIAD[OA]|RECEBID[OA]|CRED|DEB)?\s*(?:PARA|A|DE)\s+([A-ZÀ-Úa-zà-ú][A-ZÀ-Úa-zà-ú\s.'-]{2,80}?)(?=\s+-\s|\s+(?:AG|CC|BCO|BANCO|CPF|CNPJ|TRANSA[CÇ][AÃ]O|#)|$)/i,
      // Fallback antigo (nomes em caixa alta contíguos)
      /(?:PIX|TED|DOC|TRANSF(?:ERENCIA)?|PAGAMENTO|PAGTO)\s+([A-ZÀ-Ú][A-ZÀ-Ú\s.]{2,60}?)(?:\s+(?:AG|CC|BCO|BANCO|CPF|CNPJ|-)|\s*$)/i,
    ];
    for (const re of patterns) {
      const nameMatch = source.match(re);
      if (nameMatch && nameMatch[1]) {
        const cleaned = nameMatch[1].trim().replace(/\s+/g, ' ');
        // Descarta se ficou pequeno demais ou é palavra-chave contexto (ex.: DÉBITO)
        if (cleaned.length >= 3 && !/^(DEBIT[OU]?|CREDIT[OU]?|PIX|TED|DOC)$/i.test(cleaned)) {
          result.name = cleaned;
          break;
        }
      }
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
  updateBoletoUI();
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

/**
 * Mostra/esconde o filtro de boleto no cabeçalho de filtros e atualiza o
 * contador. Só aparece se houver pelo menos 1 boleto detectado no arquivo.
 */
function updateBoletoUI() {
  const wrapper = document.getElementById('boleto-filter-wrapper');
  const countEl = document.getElementById('boleto-count');
  const total = state.transactions.filter((t) => t.isBoleto).length;
  if (countEl) countEl.textContent = String(total);
  if (wrapper) {
    if (total > 0) wrapper.classList.remove('hidden');
    else wrapper.classList.add('hidden');
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

/**
 * Descobre a data/hora da PRIMEIRA transação (mais antiga). Retorna null
 * se não houver transações com data válida. Diferente de accountInfo.startDate
 * (que é DTSTART do cabeçalho OFX), esta é a data REAL da transação mais
 * antiga presente no arquivo.
 */
function computeTxnRangeStart() {
  let min = null;
  for (const t of state.transactions) {
    if (t.date && !isNaN(t.date.getTime())) {
      if (!min || t.date < min) min = t.date;
    }
  }
  return min;
}
function computeTxnRangeEnd() {
  let max = null;
  for (const t of state.transactions) {
    if (t.date && !isNaN(t.date.getTime())) {
      if (!max || t.date > max) max = t.date;
    }
  }
  return max;
}
/** Atualiza o badge "Período do documento" no cabeçalho de filtros. */
function updatePeriodInfo(start, end) {
  const wrapper = document.getElementById('filters-period-info');
  const rangeEl = document.getElementById('filters-period-range');
  if (!wrapper || !rangeEl) return;
  if (start && end) {
    rangeEl.textContent = `${formatDateTimeBR(start)} até ${formatDateTimeBR(end)}`;
    wrapper.classList.remove('hidden');
    wrapper.classList.add('inline-flex');
  } else {
    wrapper.classList.add('hidden');
    wrapper.classList.remove('inline-flex');
  }
}

function setupFilters() {
  // Determina o intervalo real das TRANSAÇÕES (não do cabeçalho OFX,
  // pois DTSTART/DTEND às vezes é o dia inteiro, não a hora real).
  const realStart = computeTxnRangeStart();
  const realEnd = computeTxnRangeEnd();

  // Define datas iniciais baseadas nas transações (com hora)
  if (state.accountInfo.startDate) {
    const startAtMidnight = new Date(state.accountInfo.startDate);
    startAtMidnight.setHours(0, 0, 0, 0);
    filterStart.value = formatDateTimeBR(startAtMidnight);
  }
  if (state.accountInfo.endDate) {
    const endAtEndOfDay = new Date(state.accountInfo.endDate);
    endAtEndOfDay.setHours(23, 59, 0, 0);
    filterEnd.value = formatDateTimeBR(endAtEndOfDay);
  }

  // Mostra o PERÍODO REAL do documento (primeira e última transação)
  // no bloco de filtros para orientar o usuário sobre o intervalo válido.
  updatePeriodInfo(realStart, realEnd);

  // === Substitui o datepicker nativo por Flatpickr ===
  // O calendário nativo é minúsculo e não pode ser estilizado. Flatpickr
  // renderiza um calendário maior e customizável, respondendo ao pedido
  // do usuário de "quando abrir o calendário fique maior e melhor".
  // Dispara 'change' no input original para preservar os handlers de filtro.
  initFlatpickr();


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

  // === Botão borracha (eraser) do filtro Conta Destino/Origem ===
  // Atualiza visibilidade do botão sempre que o input muda.
  filterCounterparty.addEventListener('input', updateCounterpartyClearBtn);
  const clearCpBtn = document.getElementById('filter-counterparty-clear');
  if (clearCpBtn) {
    clearCpBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      filterCounterparty.value = '';
      updateCounterpartyClearBtn();
      state.currentPage = 1;
      applyFilters();
      // Devolve o foco ao input para o usuário poder digitar de novo se quiser
      filterCounterparty.focus();
    });
  }
  // Estado inicial do botão eraser (pode já ter valor pré-preenchido)
  updateCounterpartyClearBtn();

  // Filtro estorno (checkbox)
  const filterReversal = document.getElementById('filter-reversal');
  if (filterReversal) {
    filterReversal.addEventListener('change', () => {
      state.currentPage = 1;
      applyFilters();
    });
  }

  // Filtro boleto (dropdown)
  const filterBoleto = document.getElementById('filter-boleto');
  if (filterBoleto) {
    filterBoleto.addEventListener('change', () => {
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
    // Se filtrou por CRÉDITO mas o movimento só tem débitos (ou vice-versa),
    // limpa o filtro de contraparte automaticamente
    if (typeF === 'credit' && data.creditCount === 0) {
      filterCounterparty.value = '';
    } else if (typeF === 'debit' && data.debitCount === 0) {
      filterCounterparty.value = '';
    }
    updateCounterpartyClearBtn();
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
    const filterReversal = document.getElementById('filter-reversal');
    if (filterReversal) filterReversal.value = 'all';
    const filterBoleto = document.getElementById('filter-boleto');
    if (filterBoleto) filterBoleto.value = 'all';
    updateCounterpartyClearBtn();
    state.currentPage = 1;
    applyFilters();
  });

  exportBtn.addEventListener('click', exportCSV);
}

/**
 * Inicializa Flatpickr nos inputs de data/hora dos filtros.
 *
 * REQUISITO do usuário: quer PODER DIGITAR a data manualmente. O
 * calendário só abre quando clica no ÍCONE ao lado do input (não abre
 * automaticamente no focus/click do input, como faria o Flatpickr padrão).
 *
 * Estratégia:
 *  - `allowInput: true` — deixa o Flatpickr aceitar digitação livre
 *  - `clickOpens: false` — NÃO abre picker ao clicar/focar no input
 *  - O botão .datetime-cal-btn (ícone) chama fp.open() manualmente
 *  - Ao digitar, aceita formato brasileiro dd/mm/aaaa HH:MM (via parseDate)
 *  - `dateFormat` = 'd/m/Y H:i' porque agora o input é TEXT (não datetime-local),
 *    então o valor exibido = valor persistido, sem altInput duplicado.
 */
// Guarda as instâncias criadas para poder abrir programaticamente
const flatpickrInstances = { start: null, end: null };

function initFlatpickr() {
  if (typeof window.flatpickr !== 'function') {
    console.warn('Flatpickr não carregou — mantendo input de texto simples.');
    return;
  }
  const commonOpts = {
    enableTime: true,
    time_24hr: true,
    dateFormat: 'd/m/Y H:i',
    minuteIncrement: 1,
    allowInput: true,   // permite digitar manualmente
    clickOpens: false,  // NÃO abre ao clicar no input (só pelo botão)
    locale: (window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.pt) || 'default',
    // Dispara 'change' no input original para acionar applyFilters()
    onChange: function(_selDates, _dateStr, instance) {
      instance.input.dispatchEvent(new Event('change', { bubbles: true }));
    },
  };
  flatpickrInstances.start = window.flatpickr(filterStart, {
    ...commonOpts,
    defaultDate: filterStart.value || null,
  });
  flatpickrInstances.end = window.flatpickr(filterEnd, {
    ...commonOpts,
    defaultDate: filterEnd.value || null,
  });

  // Botões-calendário abrem o picker manualmente
  const btnStart = document.getElementById('filter-start-cal');
  const btnEnd = document.getElementById('filter-end-cal');
  if (btnStart) {
    btnStart.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (flatpickrInstances.start) flatpickrInstances.start.open();
    });
  }
  if (btnEnd) {
    btnEnd.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (flatpickrInstances.end) flatpickrInstances.end.open();
    });
  }
}

/**
 * Converte um valor de filtro (dd/mm/aaaa HH:MM ou datetime-local) em Date.
 * Retorna Date válida ou null se não parseável.
 * Como os inputs agora são TEXT no formato pt-BR, precisamos parse manual.
 */
function parseFilterDateTime(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;
  // Formato brasileiro: dd/mm/aaaa HH:MM (permite HH:MM:SS opcional)
  const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (brMatch) {
    const [, d, m, y, hh, mm, ss] = brMatch;
    const dt = new Date(
      parseInt(y, 10),
      parseInt(m, 10) - 1,
      parseInt(d, 10),
      hh ? parseInt(hh, 10) : 0,
      mm ? parseInt(mm, 10) : 0,
      ss ? parseInt(ss, 10) : 0
    );
    return isNaN(dt.getTime()) ? null : dt;
  }
  // Formato ISO/datetime-local: YYYY-MM-DDTHH:MM
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Formata Date → "dd/mm/aaaa HH:MM" (mesmo formato dos filtros agora). */
function formatDateTimeBR(d) {
  if (!d || isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Popula o mapa completo de movimentos (antigas "contrapartes") com totais por tipo.
 * Chamado uma vez ao carregar o arquivo.
 *
 * Regras importantes:
 *  - Chave de agrupamento: usa t.movementKey (consolida PIX por nome).
 *  - Estornos são contados no bucket ORIGINAL do OFX (crédito ou débito)
 *    para PRESERVAR os totais reais. Estorno-crédito (Recebido de X)
 *    entra em totalCredit; devolução-débito (Enviado para X) entra em
 *    totalDebit. Adicionalmente, reversalCount/totalReversal são
 *    rastreados como métrica independente para o badge de estornos.
 *  - reversalRecipients: coleta nomes de "quem receberia a transação
 *    original" (útil para identificar rapidamente no card).
 *  - Cards herdam a "cor dominante": só créditos = verde, só débitos =
 *    vermelho, mistos = neutro.
 */
function populateCounterpartyList() {
  const nameCount = new Map();
  state.transactions.forEach((t) => {
    // Preferência: chave normalizada de movimento (agrupamento PIX).
    // Fallbacks: nome, rótulo completo.
    const key = t.movementKey || t.counterpartyName || t.counterparty;
    if (!key) return;
    if (!nameCount.has(key)) {
      nameCount.set(key, {
        count: 0,
        creditCount: 0,
        debitCount: 0,
        reversalCount: 0,        // total de estornos com esse movimento
        reversalCreditCount: 0,  // estornos que são créditos (recebidos)
        reversalDebitCount: 0,   // estornos que são débitos (devolvidos)
        totalCredit: 0,
        totalDebit: 0,
        totalReversal: 0,        // valor absoluto acumulado dos estornos
        reversalRecipients: new Set(), // quem receberia a transação original
        displayName: t.counterpartyName || t.counterparty || key,
      });
    }
    const entry = nameCount.get(key);
    entry.count++;

    // Preserva o tipo original do OFX nos totais (não reclassifica).
    if (t.type === 'credit') {
      entry.creditCount++;
      entry.totalCredit += t.amount;
    } else {
      entry.debitCount++;
      entry.totalDebit += t.absAmount;
    }

    // Estornos são rastreados adicionalmente (métrica paralela).
    if (t.isReversal) {
      entry.reversalCount++;
      entry.totalReversal += t.absAmount;
      if (t.type === 'credit') {
        entry.reversalCreditCount++;
      } else {
        entry.reversalDebitCount++;
      }
      // Coleta o destinatário/contraparte da transação original.
      // Prioriza reversalRecipient (do lookup por Transação #NNNNN);
      // ignora se for igual ao próprio displayName (evitar redundância).
      const recipient = (t.reversalRecipient || '').trim();
      if (recipient && recipient.toLowerCase() !== entry.displayName.toLowerCase()) {
        entry.reversalRecipients.add(recipient);
      }
    }
  });
  const sorted = [...nameCount.entries()].sort((a, b) => b[1].count - a[1].count);
  state.counterpartyList = sorted;
  renderCounterpartyPanel();
}

/**
 * Renderiza o painel de "Movimentos" — versão SIMPLIFICADA (dois cards).
 *
 * Só existem DOIS cards fixos:
 *   1) Card Crédito (verde)  — total e contagem de todos os créditos.
 *   2) Card Débito (vermelho) — total e contagem de todos os débitos.
 *
 * A lista detalhada por contraparte foi removida do painel principal
 * (a pedido do usuário). Para ver as contrapartes individuais o usuário
 * usa o autocomplete do filtro "Conta Destino/Origem" (mantido para busca).
 *
 * Cada card funciona como um filtro por tipo: clicar no card Crédito
 * aplica typeFilter='credit', clicar no Débito aplica typeFilter='debit',
 * clicar novamente no card já ativo volta para 'all'.
 */
function renderCounterpartyPanel() {
  const panel = document.getElementById('counterparty-panel');
  const countLabel = document.getElementById('counterparty-count');
  if (!panel) return;

  const typeFilter = filterType.value; // 'all' | 'credit' | 'debit'
  const reversalOnly = state.reversalOnlyMode;

  // === Agrega TODAS as transações do extrato (não por contraparte) ===
  // Usamos state.transactions diretamente — os totais por tipo aqui são
  // o que o comprovante bancário mostraria: soma de créditos e débitos
  // brutos, sem consolidação por contraparte.
  let creditCount = 0;
  let debitCount = 0;
  let totalCredit = 0;
  let totalDebit = 0;
  let reversalCount = 0;
  let reversalCreditCount = 0;
  let reversalDebitCount = 0;
  let totalReversal = 0;

  (state.transactions || []).forEach((t) => {
    if (t.type === 'credit') {
      creditCount++;
      totalCredit += t.amount;
    } else {
      debitCount++;
      totalDebit += t.absAmount;
    }
    if (t.isReversal) {
      reversalCount++;
      totalReversal += t.absAmount;
      if (t.type === 'credit') reversalCreditCount++;
      else reversalDebitCount++;
    }
  });

  // Popula datalist do autocomplete com TODAS as contrapartes conhecidas
  // (o filtro Conta Destino/Origem continua sendo por contraparte).
  if (counterpartyList && state.counterpartyList) {
    counterpartyList.innerHTML = state.counterpartyList
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

  // === Cabeçalho: totais gerais (independentes do filtro) ===
  const totalsEl = document.getElementById('counterparty-totals');
  if (totalsEl) {
    const parts = [];
    if (totalCredit > 0) {
      parts.push(`<span class="text-green-400 font-semibold" title="${creditCount} crédito(s)"><i class="fas fa-arrow-up mr-1"></i>${formatCurrency(totalCredit)}</span>`);
    }
    if (totalDebit > 0) {
      parts.push(`<span class="text-red-400 font-semibold" title="${debitCount} débito(s)"><i class="fas fa-arrow-down mr-1"></i>${formatCurrency(totalDebit)}</span>`);
    }
    if (reversalCount > 0) {
      parts.push(`<span class="text-amber-400 font-semibold" title="${reversalCount} estorno(s)"><i class="fas fa-undo mr-1"></i>${formatCurrency(totalReversal)}</span>`);
    }
    totalsEl.innerHTML = parts.join('<span class="mx-2 text-slate-600">·</span>');
  }

  // === Rótulo de contagem no cabeçalho ===
  if (countLabel) {
    const total = (state.transactions || []).length;
    countLabel.textContent = `(${total} transações)`;
  }

  // === Renderiza APENAS 2 cards: Crédito e Débito ===
  const cards = [];
  const creditActive = typeFilter === 'credit';
  const debitActive = typeFilter === 'debit';

  cards.push(`
    <button type="button" data-filter="credit"
      class="movement-card mv-credit ${creditActive ? 'mv-active' : ''}"
      title="Ver apenas créditos">
      <span class="mv-name">
        <i class="fas fa-arrow-up mr-1"></i>Créditos
        ${reversalCreditCount > 0
          ? `<span class="badge badge-reversal align-middle ml-1" title="${reversalCreditCount} estorno(s)"><i class="fas fa-undo mr-0.5"></i>${reversalCreditCount}</span>`
          : ''}
      </span>
      <div class="mv-meta">
        <span class="whitespace-nowrap"><i class="fas fa-hashtag mr-1 opacity-60"></i>${creditCount} transações</span>
        <div class="mv-totals">
          <span class="mv-total-credit">${formatCurrency(totalCredit)}</span>
        </div>
      </div>
    </button>
  `);

  cards.push(`
    <button type="button" data-filter="debit"
      class="movement-card mv-debit ${debitActive ? 'mv-active' : ''}"
      title="Ver apenas débitos">
      <span class="mv-name">
        <i class="fas fa-arrow-down mr-1"></i>Débitos
        ${reversalDebitCount > 0
          ? `<span class="badge badge-reversal align-middle ml-1" title="${reversalDebitCount} devolução(ões)"><i class="fas fa-undo mr-0.5"></i>${reversalDebitCount}</span>`
          : ''}
      </span>
      <div class="mv-meta">
        <span class="whitespace-nowrap"><i class="fas fa-hashtag mr-1 opacity-60"></i>${debitCount} transações</span>
        <div class="mv-totals">
          <span class="mv-total-debit">${formatCurrency(totalDebit)}</span>
        </div>
      </div>
    </button>
  `);

  panel.innerHTML = cards.join('');

  // === Clique nos cards → aplica/toggle filtro de tipo ===
  panel.querySelectorAll('.movement-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wantedType = btn.getAttribute('data-filter');
      // Toggle: clicar no já-ativo volta para 'all'
      filterType.value = (filterType.value === wantedType) ? 'all' : wantedType;
      state.currentPage = 1;
      applyFilters();
      renderCounterpartyPanel(); // re-render para atualizar mv-active
    });
  });
}

/**
 * Atualiza a visibilidade do botão eraser do filtro Conta Destino/Origem.
 * O CSS mostra o botão apenas quando o wrapper tem classe .has-value.
 */
function updateCounterpartyClearBtn() {
  const wrapper = document.getElementById('filter-counterparty-wrapper');
  const input = document.getElementById('filter-counterparty');
  if (!wrapper || !input) return;
  if (input.value.trim().length > 0) {
    wrapper.classList.add('has-value');
  } else {
    wrapper.classList.remove('has-value');
  }
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

  // Filtro por data/hora — inputs agora são TEXT em formato brasileiro
  // (dd/mm/aaaa HH:MM). Usa parseFilterDateTime que também aceita ISO.
  const startDt = parseFilterDateTime(filterStart.value);
  if (startDt) {
    result = result.filter((t) => t.date && t.date >= startDt);
  }
  const endDt = parseFilterDateTime(filterEnd.value);
  if (endDt) {
    result = result.filter((t) => t.date && t.date <= endDt);
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

  // Filtro por conta destino/origem (contraparte) - também com busca combinada.
  // Inclui movementKey no haystack para que a seleção de um card PIX
  // consolidado (que usa apenas o nome normalizado) case corretamente
  // com todas as transações PIX daquele nome.
  const cpRaw = filterCounterparty.value.trim();
  if (cpRaw) {
    const tokens = parseSearchQuery(cpRaw);
    result = result.filter((t) => {
      const haystack = normalizeText(
        `${t.counterparty || ''} ${t.counterpartyName || ''} ${
          t.counterpartyAccount || ''
        } ${t.counterpartyBank || ''} ${t.counterpartyBranch || ''} ${
          t.movementKey || ''
        }`
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

  // Filtro por pagamento de boleto (dropdown do painel de filtros)
  const filterBoletoEl = document.getElementById('filter-boleto');
  if (filterBoletoEl) {
    const blMode = filterBoletoEl.value;
    if (blMode === 'only') result = result.filter((t) => t.isBoleto);
    else if (blMode === 'exclude') result = result.filter((t) => !t.isBoleto);
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
      // Badge de estorno simplificado: só ícone + "Estorno" (motivo detalhado
      // removido a pedido do usuário — a intenção já fica clara pelo ícone).
      const reversalBadge = t.isReversal
        ? `<span class="badge badge-reversal ml-1" title="Estorno / Devolução"><i class="fas fa-undo mr-1"></i>Estorno</span>`
        : '';
      const boletoBadge = t.isBoleto
        ? `<span class="badge badge-boleto ml-1" title="${escapeHtml(t.boletoReason || 'Boleto')}"><i class="fas fa-barcode mr-1"></i>${escapeHtml(t.boletoReason || 'Boleto')}</span>`
        : '';
      const isSelected = state.selectedIds.has(t.id);
      const rowClass = isSelected
        ? 'bg-blue-50 dark:bg-blue-900/20'
        : (t.isReversal ? 'bg-amber-50/40 dark:bg-amber-900/10'
          : (t.isBoleto ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''));
      const balBefore = t.balanceBefore != null
        ? `<span class="text-gray-600 dark:text-slate-300">${formatCurrency(t.balanceBefore)}</span>`
        : dash;
      const balAfter = t.balanceAfter != null
        ? `<span class="${t.balanceAfter >= 0 ? 'text-gray-800 dark:text-slate-100 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}">${formatCurrency(t.balanceAfter)}</span>`
        : dash;
      // Coluna Destinatário Estorno (só para estornos): mostra o nome
      // da contraparte da transação ORIGINAL (via lookup por
      // CORRECTFITID ou por "Transação #NNNNN"). Nunca cai no nome do
      // próprio estorno — se não conseguiu resolver, mostra "Não identificado".
      const reversalRecipientCell = t.isReversal && t.reversalRecipient
        ? `<span class="text-amber-800 dark:text-amber-200 font-medium" title="Contraparte da transação original">${escapeHtml(t.reversalRecipient)}</span>`
        : (t.isReversal ? '<span class="text-gray-400 dark:text-slate-500 italic text-xs">Não identificado</span>' : dash);

      // Coluna TxId / EndToEnd — os identificadores do comprovante:
      //  - TxId    = REFNUM do OFX (ID da instituição, ex: SE0003...,
      //              CIELO..., mpqrinter...). Aparece SEMPRE quando o
      //              OFX tem REFNUM. Fallback: FITID.
      //  - E2E     = EndToEndId BACEN (E\d{31,32}). Só aparece quando
      //              o OFX contém o padrão E2E BACEN (raro em Nubank/
      //              InfoPago — o app do banco busca em API separada).
      let txIdCell = dash;
      if (t.txId || t.endToEnd) {
        const lines = [];
        if (t.endToEnd) {
          // E2E BACEN em destaque quando existe (é o identificador
          // mais autoritativo — funciona pra qualquer banco).
          lines.push(`<div class="text-[11px] text-blue-300 font-mono break-all" title="EndToEndId BACEN — identificador universal do PIX. Serve para consulta em qualquer banco."><span class="text-[9px] text-blue-400/70 font-sans uppercase mr-1 tracking-wide">E2E</span>${escapeHtml(t.endToEnd)}</div>`);
        }
        if (t.txId) {
          lines.push(`<div class="text-[11px] text-slate-200 font-mono break-all" title="TxId — ID da transação na instituição financeira (aparece no comprovante do banco)."><span class="text-[9px] text-slate-500 font-sans uppercase mr-1 tracking-wide">TxId</span>${escapeHtml(t.txId)}</div>`);
        }
        txIdCell = `<div class="space-y-0.5 max-w-[220px]">${lines.join('')}</div>`;
      }

      // Todas as células centralizadas horizontalmente (requisito do
      // usuário: "centralize o texto das colunas"). Valores e saldos
      // ficam à direita do centro dentro da célula pela natureza numérica.
      return `
        <tr class="${rowClass}">
          <td class="px-2 py-3 text-center align-middle">
            <input type="checkbox" class="row-checkbox rounded border-gray-300 dark:border-slate-500 text-blue-600 focus:ring-blue-500 cursor-pointer" data-id="${escapeHtml(t.id)}" ${isSelected ? 'checked' : ''} />
          </td>
          <td class="px-3 py-3 text-sm text-gray-700 dark:text-slate-300 whitespace-nowrap text-center align-middle">${formatDateTime(t.date)}</td>
          <td class="px-3 py-3 whitespace-nowrap text-center align-middle">
            <span class="badge ${badgeClass}">
              <i class="fas fa-${t.type === 'credit' ? 'arrow-up' : 'arrow-down'} mr-1"></i>
              ${getTrnTypeLabel(t.trnType)}
            </span>
            ${reversalBadge}
            ${boletoBadge}
          </td>
          <td class="px-3 py-3 text-sm text-gray-800 dark:text-slate-200 max-w-md text-center align-middle">${escapeHtml(t.description)}</td>
          <td class="px-3 py-3 text-sm text-gray-700 dark:text-slate-300 text-center align-middle">${cpDisplay}</td>
          <td class="px-3 py-3 text-sm text-center align-middle">${reversalRecipientCell}</td>
          <td class="px-3 py-3 text-center align-middle">${txIdCell}</td>
          <td class="px-3 py-3 text-sm font-semibold text-center whitespace-nowrap align-middle ${valueClass}">
            ${sign} ${formatCurrency(t.absAmount)}
          </td>
          <td class="px-3 py-3 text-xs text-center whitespace-nowrap align-middle">${balBefore}</td>
          <td class="px-3 py-3 text-xs text-center whitespace-nowrap align-middle">${balAfter}</td>
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
          ? `<span class="badge badge-reversal ml-1"><i class="fas fa-undo mr-1"></i>Estorno</span>`
          : '';
        const boletoBadge = t.isBoleto
          ? `<span class="badge badge-boleto ml-1"><i class="fas fa-barcode mr-1"></i>${escapeHtml(t.boletoReason || 'Boleto')}</span>`
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
        // Bloco extra do estorno (mobile): APENAS o destinatário original,
        // que é a informação útil. Motivo e FITID Original foram removidos.
        const reversalDetails = t.isReversal
          ? `<div class="mt-1 p-2 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800 text-[11px]">
               ${t.reversalRecipient
                 ? `<div class="text-amber-700 dark:text-amber-300"><i class="fas fa-undo mr-1 text-amber-600 dark:text-amber-400"></i><span class="text-amber-600 dark:text-amber-400">Destinatário original:</span> <span class="font-semibold">${escapeHtml(t.reversalRecipient)}</span></div>`
                 : `<div class="text-amber-700 dark:text-amber-300 italic"><i class="fas fa-undo mr-1"></i>Estorno — destinatário original não identificado</div>`}
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
                  ${boletoBadge}
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
  const loadMoreWrap = document.getElementById('load-more-wrapper');
  const loadMoreLbl = document.getElementById('load-more-label');

  // Só mostra paginação se há mais de uma página
  if (pages <= 1) {
    pagination.classList.add('hidden');
    if (loadMoreWrap) loadMoreWrap.classList.add('hidden');
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

  // Botão "Carregar mais": mostra quando existem itens além dos já exibidos
  if (loadMoreWrap) {
    const remaining = total - to;
    if (remaining > 0) {
      loadMoreWrap.classList.remove('hidden');
      if (loadMoreLbl) {
        const next = Math.min(state.pageSize, remaining);
        loadMoreLbl.textContent = `Carregar mais ${next} (restam ${remaining})`;
      }
    } else {
      loadMoreWrap.classList.add('hidden');
    }
  }
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
  'Destinatário Estorno',
  'Boleto',
  'Tipo Boleto',
  'TxId',
  'EndToEndId (PIX)',
  'Valor',
  'Saldo Antes',
  'Saldo Após',
];

/** Monta uma linha de exportação a partir de uma transação */
function buildExportRow(t) {
  const tipoBase = getTrnTypeLabel(t.trnType);
  const tipoFlags = [];
  if (t.isReversal) tipoFlags.push('Estorno');
  if (t.isBoleto) tipoFlags.push('Boleto');
  const tipoStr = tipoFlags.length ? `${tipoBase} (${tipoFlags.join(', ')})` : tipoBase;
  return [
    formatDateTime(t.date),
    tipoStr,
    t.description || '',
    t.counterparty || '',
    t.isReversal ? (t.reversalRecipient || '') : '',
    t.isBoleto ? 'Sim' : '',
    t.isBoleto ? (t.boletoReason || 'Boleto') : '',
    t.txId || t.fitId || t.id || '',
    t.endToEnd || '',
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
  const boletoEl = document.getElementById('filter-boleto');
  if (boletoEl && boletoEl.value === 'only') list.push('Somente boletos');
  if (boletoEl && boletoEl.value === 'exclude') list.push('Sem boletos');
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
    t.isReversal ? (t.reversalRecipient || '').replace(/"/g, '""') : '',
    t.isBoleto ? 'Sim' : '',
    t.isBoleto ? (t.boletoReason || 'Boleto') : '',
    t.txId || t.fitId || t.id || '',
    t.endToEnd || '',
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
  const boletoCount = source.filter((t) => t.isBoleto).length;
  const totalBoleto = source
    .filter((t) => t.isBoleto)
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
  if (boletoCount > 0) {
    summaryCards.push({
      label: 'Boletos',
      value: formatCurrency(totalBoleto),
      sub: `${boletoCount} pagamentos`,
      color: [30, 64, 175], // blue-800
      accent: [37, 99, 235], // blue-600
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
  // Headers e rows: identificadores em DUAS colunas —
  //  - TxId    : ID que aparece no comprovante ("Transação #NNNNN" do MEMO
  //              ou FITID como fallback).
  //  - EndToEnd: EndToEndId BACEN (REFNUM do OFX), só quando é PIX com E2E.
  const head = [[
    'Data/Hora', 'Tipo', 'Descrição', 'Conta Destino/Origem',
    'Destinatário Estorno',
    'TxId', 'EndToEndId (PIX)', 'Valor', 'Saldo Antes', 'Saldo Após'
  ]];
  const rows = source.map((t) => [
    formatDateTime(t.date),
    getTrnTypeLabel(t.trnType) + (t.isReversal ? ' *' : ''),
    t.description || '',
    t.counterparty || '-',
    t.isReversal ? (t.reversalRecipient || '') : '',
    t.txId || t.fitId || t.id || '-',
    t.endToEnd || '-',
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
      0: { cellWidth: 22 },                                 // Data
      1: { cellWidth: 18 },                                 // Tipo
      2: { cellWidth: 'auto' },                             // Descrição
      3: { cellWidth: 28 },                                 // Contraparte
      4: { cellWidth: 22 },                                 // Destinatário Estorno
      5: { cellWidth: 18, font: 'courier', fontSize: 5.5 }, // TxId
      6: { cellWidth: 28, font: 'courier', fontSize: 5.5 }, // EndToEndId
      7: { cellWidth: 20, halign: 'right', fontStyle: 'bold' }, // Valor
      8: { cellWidth: 18, halign: 'right' },                // Saldo Antes
      9: { cellWidth: 20, halign: 'right', fontStyle: 'bold' }, // Saldo Após
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const t = source[data.row.index];
      // Estornos: fundo amber suave em toda a linha (prioridade sobre boleto)
      if (t && t.isReversal) {
        data.cell.styles.fillColor = COL.reversalBg;
      } else if (t && t.isBoleto) {
        // Boleto: fundo azul suave
        data.cell.styles.fillColor = [219, 234, 254]; // blue-100
      }
      // Coluna VALOR (7): verde ou vermelho
      if (data.column.index === 7) {
        data.cell.styles.textColor = t.amount >= 0 ? COL.green : COL.red;
      }
      // Saldo após (9) negativo: vermelho
      if (data.column.index === 9 && t.balanceAfter != null && t.balanceAfter < 0) {
        data.cell.styles.textColor = COL.red;
      }
      // Destinatário Estorno (4): amber escuro
      if (data.column.index === 4 && t.isReversal && t.reversalRecipient) {
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
  // LEGENDA (se houver estornos ou boletos)
  // ==========================================================================
  const boletoCountExport = source.filter((t) => t.isBoleto).length;
  if (reversalCount > 0 || boletoCountExport > 0) {
    let legY = endY + totalCardH + 4;
    if (legY > pageHeight - 15) {
      doc.addPage();
      legY = 15;
    }
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COL.slate500);

    if (reversalCount > 0) {
      doc.setFillColor(...COL.reversalBg);
      doc.rect(margin, legY, 4, 4, 'F');
      doc.text(
        'Linhas em amarelo: estorno/devolução (marcadas também na coluna Tipo).',
        margin + 6,
        legY + 3
      );
      legY += 5;
    }
    if (boletoCountExport > 0) {
      doc.setFillColor(219, 234, 254); // blue-100
      doc.rect(margin, legY, 4, 4, 'F');
      doc.text(
        'Linhas em azul: pagamento de boleto/título bancário (col. Boleto = Sim).',
        margin + 6,
        legY + 3
      );
    }
  }

  doc.save(`extrato_${formatDateISO(new Date())}.pdf`);
}

// ============================================================
// TEMA — dark-only (versão clara foi removida)
// ============================================================
/**
 * Aplicativo é dark-only. O script inline no <head> já garante que
 * a classe .dark exista no <html> antes do primeiro paint. Aqui só
 * reforçamos como defesa em profundidade.
 */
function initTheme() {
  const root = document.documentElement;
  root.classList.add('dark');
  root.style.colorScheme = 'dark';
  try { localStorage.setItem('theme', 'dark'); } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();

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

  // === SortableJS: reordenar blocos do dashboard por arrastar ===
  initDashboardSort();

  // === Botão "Carregar mais" (paginação incremental) ===
  initLoadMore();

  // === Botão "Adicionar próximo OFX" (extratos sequenciais) ===
  initAppendOfx();
});

// ============================================================
// SORTABLE: reordenar blocos do dashboard
// ============================================================
/**
 * Deixa os blocos principais reordenáveis por drag-and-drop.
 * A ordem é persistida em localStorage sob a chave 'ofx-block-order'.
 * A alça de arraste é o elemento `.block-drag-handle` (topo do bloco).
 */
const BLOCK_ORDER_KEY = 'ofx-block-order';

function initDashboardSort() {
  const container = document.getElementById('dashboard-blocks');
  if (!container) return;

  // Restaura ordem salva ANTES de instanciar o Sortable (senão o
  // Sortable "vê" a ordem inicial e serialize retorna ela).
  applyBlockOrder();

  if (typeof window.Sortable !== 'function') {
    console.warn('SortableJS não carregou — ordenação por drag desativada.');
    return;
  }

  window.Sortable.create(container, {
    handle: '.block-drag-handle',
    animation: 180,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onEnd: () => {
      const order = Array.from(container.querySelectorAll(':scope > .draggable-block'))
        .map((el) => el.getAttribute('data-block-id'))
        .filter(Boolean);
      try { localStorage.setItem(BLOCK_ORDER_KEY, JSON.stringify(order)); } catch (e) {}
    },
  });
}

function applyBlockOrder() {
  const container = document.getElementById('dashboard-blocks');
  if (!container) return;
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(BLOCK_ORDER_KEY) || 'null');
  } catch (e) { saved = null; }
  if (!Array.isArray(saved) || !saved.length) return;

  const blocks = new Map();
  container.querySelectorAll(':scope > .draggable-block').forEach((el) => {
    const id = el.getAttribute('data-block-id');
    if (id) blocks.set(id, el);
  });

  // Anexa na ordem salva; blocos novos ficam no fim
  saved.forEach((id) => {
    const el = blocks.get(id);
    if (el) container.appendChild(el);
    blocks.delete(id);
  });
  blocks.forEach((el) => container.appendChild(el));
}

// ============================================================
// PAGINAÇÃO INCREMENTAL - "Carregar mais"
// ============================================================
/**
 * Botão "Carregar mais" — em vez de navegar de página, INCREMENTA
 * o pageSize efetivo para mostrar mais transações abaixo, e faz
 * scroll suave até a nova posição.
 *
 * Nota: não altera state.pageSize (que ainda controla o seletor),
 * mas incrementa state.currentPage para pular pra próxima faixa.
 * Estratégia mais simples: aumenta pageSize temporariamente para
 * carregar tudo até a página desejada.
 */
function initLoadMore() {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    // Aumenta o pageSize efetivo em +pageSize (dobra a quantidade
    // visível) e re-renderiza. Como currentPage=1 e pageSize maior,
    // mais itens aparecem na mesma "página".
    const extra = state.pageSize;
    state.pageSize = state.pageSize + extra;
    state.currentPage = 1;
    renderTable();
    // Sincroniza o select mantendo o valor original visual — não
    // sobrescrevemos o valor exibido no <select> para não confundir.
    // Scroll até o fim da tabela para o usuário ver os novos itens.
    setTimeout(() => {
      const tbody = document.getElementById('transactions-tbody');
      if (tbody && tbody.lastElementChild) {
        tbody.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
  });
}

// ============================================================
// UPLOAD SEQUENCIAL DE OFX (extratos concatenáveis)
// ============================================================
/**
 * Permite ao usuário anexar um segundo OFX que representa um período
 * subsequente. O sistema:
 *  1. Faz parse do novo arquivo
 *  2. Detecta divergências (sobreposição, gap, mesma janela)
 *  3. Mescla as transações (deduplicando por FITID)
 *  4. Recalcula tudo (saldos, filtros, período)
 *  5. Mostra alerta com o resumo dos dois extratos
 */
function initAppendOfx() {
  const btn = document.getElementById('append-file-btn');
  const input = document.getElementById('append-file-input');
  if (!btn || !input) return;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleAppendFile(e.target.files[0]);
      input.value = ''; // permite reanexar o mesmo arquivo
    }
  });
}

function handleAppendFile(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'ofx') {
    showAppendAlert('err', '<strong>Arquivo inválido</strong>: precisa ser .ofx');
    return;
  }
  if (!state.transactions.length) {
    showAppendAlert('err', 'Nenhum extrato foi carregado ainda.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const buf = ev.target.result;
      const enc = detectOFXEncoding(buf);
      const decoder = new TextDecoder(enc, { fatal: false });
      const content = decoder.decode(buf);
      const parsed = parseOFX(content);
      mergeSequentialOFX(parsed, file.name);
    } catch (err) {
      console.error(err);
      showAppendAlert('err', 'Erro ao processar arquivo: ' + err.message);
    }
  };
  reader.onerror = () => showAppendAlert('err', 'Não foi possível ler o arquivo.');
  reader.readAsArrayBuffer(file);
}

/**
 * Mescla um segundo extrato com o carregado. Detecta:
 *  - Sobreposição: janelas se cruzam → aviso de warn
 *  - Gap: existe intervalo vazio entre um e outro → aviso de warn
 *  - Conta diferente: ACCTID diferente → erro
 *  - Sequencial perfeito: sem gap nem sobreposição → sucesso
 */
function mergeSequentialOFX(parsed, filename) {
  const { accountInfo: newInfo, transactions: newTxns } = parsed;

  // Valida se é a mesma conta (ACCTID)
  const currentAcct = String(state.accountInfo.accountId || '').trim();
  const newAcct = String(newInfo.accountId || '').trim();
  if (currentAcct && newAcct && currentAcct !== newAcct) {
    showAppendAlert('err',
      `<strong>Contas diferentes</strong>: o extrato atual é da conta <code>${escapeHtml(currentAcct)}</code> ` +
      `e o novo é da conta <code>${escapeHtml(newAcct)}</code>. ` +
      `Só é possível anexar extratos da MESMA conta.`
    );
    return;
  }

  // Ranges reais (por transação) — mais confiável que DTSTART/DTEND
  const curStart = computeTxnRangeStart();
  const curEnd = computeTxnRangeEnd();
  const newStart = newTxns.reduce((min, t) => (!min || (t.date && t.date < min)) ? t.date : min, null);
  const newEnd = newTxns.reduce((max, t) => (!max || (t.date && t.date > max)) ? t.date : max, null);

  if (!newStart || !newEnd) {
    showAppendAlert('err', 'O novo extrato não contém transações com data válida.');
    return;
  }

  // Detecta relação temporal entre as duas janelas
  const analysis = analyzeRanges(curStart, curEnd, newStart, newEnd);

  // Mescla e deduplica por FITID
  const seen = new Set();
  const combined = [];
  const pushUnique = (t) => {
    const key = t.fitId || t.id;
    if (seen.has(key)) return;
    seen.add(key);
    combined.push(t);
  };
  state.transactions.forEach(pushUnique);
  newTxns.forEach(pushUnique);

  // Reordena por data para o cálculo de saldo funcionar
  combined.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));

  // Recalcula evolução de saldos: âncora fica no saldo mais RECENTE
  //   se o novo extrato termina depois do atual, usa BALAMT do novo;
  //   senão, mantém o saldo atual como âncora.
  const useNewBalance = newEnd >= curEnd;
  const mergedInfo = {
    ...state.accountInfo,
    // Estende o range para incluir tudo
    startDate: (state.accountInfo.startDate && newInfo.startDate)
      ? new Date(Math.min(state.accountInfo.startDate.getTime(), newInfo.startDate.getTime()))
      : (newInfo.startDate || state.accountInfo.startDate),
    endDate: (state.accountInfo.endDate && newInfo.endDate)
      ? new Date(Math.max(state.accountInfo.endDate.getTime(), newInfo.endDate.getTime()))
      : (newInfo.endDate || state.accountInfo.endDate),
    balance: useNewBalance ? newInfo.balance : state.accountInfo.balance,
    balanceDate: useNewBalance ? newInfo.balanceDate : state.accountInfo.balanceDate,
  };
  // Recalcula saldo antes/depois de cada transação
  computeBalanceEvolution(combined, mergedInfo);

  const addedCount = combined.length - state.transactions.length;
  const duplicates = newTxns.length - addedCount;

  state.transactions = combined;
  state.accountInfo = mergedInfo;
  state.filtered = [...combined];

  // Reabre o dashboard com os dados mesclados
  renderDashboard();

  // Monta o alerta com o resumo
  const parts = [];
  parts.push(`<strong>Arquivo anexado</strong>: ${escapeHtml(filename)}`);
  parts.push(`<span class="mx-2">·</span>`);
  parts.push(`${newTxns.length} transações lidas`);
  if (duplicates > 0) {
    parts.push(`<span class="mx-2">·</span>`);
    parts.push(`${duplicates} duplicadas (ignoradas)`);
  }
  parts.push(`<span class="mx-2">·</span>`);
  parts.push(`${addedCount} novas`);

  let severity = 'ok';
  let extra = '';
  if (analysis.type === 'sequential') {
    extra = `<div class="text-xs mt-2"><i class="fas fa-check-circle mr-1"></i>Extratos sequenciais: ` +
      `1º termina em ${formatDateTimeBR(analysis.aEnd)} · 2º começa em ${formatDateTimeBR(analysis.bStart)}.</div>`;
  } else if (analysis.type === 'gap') {
    severity = 'warn';
    extra = `<div class="text-xs mt-2"><i class="fas fa-exclamation-triangle mr-1"></i>` +
      `<strong>Intervalo em branco</strong>: existe um vão entre ` +
      `${formatDateTimeBR(analysis.aEnd)} e ${formatDateTimeBR(analysis.bStart)} sem transações. ` +
      `Se você esperava movimento nesse período, pode faltar um OFX intermediário.</div>`;
  } else if (analysis.type === 'overlap') {
    severity = 'warn';
    extra = `<div class="text-xs mt-2"><i class="fas fa-exclamation-triangle mr-1"></i>` +
      `<strong>Sobreposição de períodos</strong>: as janelas se cruzam entre ` +
      `${formatDateTimeBR(analysis.overlapStart)} e ${formatDateTimeBR(analysis.overlapEnd)}. ` +
      `Transações com mesmo FITID foram deduplicadas.</div>`;
  } else if (analysis.type === 'contains') {
    severity = 'warn';
    extra = `<div class="text-xs mt-2"><i class="fas fa-exclamation-triangle mr-1"></i>` +
      `<strong>Períodos contidos</strong>: um extrato está totalmente dentro do outro. Duplicatas foram removidas.</div>`;
  } else if (analysis.type === 'reverse-sequential') {
    extra = `<div class="text-xs mt-2"><i class="fas fa-check-circle mr-1"></i>Extratos sequenciais (ordem invertida): ` +
      `1º começa em ${formatDateTimeBR(analysis.bStart)} · 2º termina em ${formatDateTimeBR(analysis.aEnd)}.</div>`;
  }

  showAppendAlert(severity, parts.join('') + extra);
}

/**
 * Analisa a relação entre dois intervalos [aStart, aEnd] e [bStart, bEnd].
 * Retorna { type, ... } com:
 *  - 'sequential': b começa logo depois de a (gap < 1 dia)
 *  - 'reverse-sequential': a começa logo depois de b
 *  - 'gap': há um intervalo maior entre eles
 *  - 'overlap': as janelas se cruzam
 *  - 'contains': uma está totalmente dentro da outra
 */
function analyzeRanges(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return { type: 'unknown' };
  const ONE_DAY = 24 * 60 * 60 * 1000;
  // b totalmente depois de a?
  if (bStart >= aEnd) {
    const gap = bStart.getTime() - aEnd.getTime();
    if (gap <= ONE_DAY) return { type: 'sequential', aEnd, bStart };
    return { type: 'gap', aEnd, bStart };
  }
  // a totalmente depois de b?
  if (aStart >= bEnd) {
    const gap = aStart.getTime() - bEnd.getTime();
    if (gap <= ONE_DAY) return { type: 'reverse-sequential', aEnd, bStart };
    return { type: 'gap', aEnd: bEnd, bStart: aStart };
  }
  // b contido em a ou a contido em b?
  if ((bStart >= aStart && bEnd <= aEnd) || (aStart >= bStart && aEnd <= bEnd)) {
    return { type: 'contains' };
  }
  // Cruzamento parcial
  const overlapStart = new Date(Math.max(aStart.getTime(), bStart.getTime()));
  const overlapEnd = new Date(Math.min(aEnd.getTime(), bEnd.getTime()));
  return { type: 'overlap', overlapStart, overlapEnd };
}

function showAppendAlert(severity, html) {
  const el = document.getElementById('append-alert');
  if (!el) return;
  el.classList.remove('append-ok', 'append-warn', 'append-err', 'hidden');
  el.classList.add('append-' + severity);
  el.innerHTML = html;
}
