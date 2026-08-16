import { Hono } from 'hono'
import { renderer } from './renderer'

const app = new Hono()

app.use(renderer)

app.get('/', (c) => {
  return c.render(
    <>
      {/* Header */}
      <header class="bg-gradient-to-r from-blue-700 to-indigo-800 dark:from-slate-800 dark:to-slate-900 text-white shadow-lg">
        <div class="w-full px-3 sm:px-6 py-4 sm:py-6 flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-3">
            <i class="fas fa-file-invoice-dollar text-2xl sm:text-3xl"></i>
            <div>
              <h1 class="text-lg sm:text-2xl font-bold leading-tight">Leitor de Extrato OFX</h1>
              <p class="text-blue-100 dark:text-slate-300 text-xs sm:text-sm hidden sm:block">
                Análise de transações bancárias com filtros avançados
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              id="reset-btn"
              class="hidden bg-white/10 hover:bg-white/20 rounded-lg px-3 py-2 text-xs sm:text-sm transition items-center gap-1"
              title="Carregar outro arquivo OFX"
            >
              <i class="fas fa-redo"></i>
              <span class="hidden sm:inline">Novo arquivo</span>
            </button>
            <div class="hidden lg:flex items-center gap-2 text-sm bg-white/10 px-3 py-2 rounded-lg">
              <i class="fas fa-shield-alt"></i>
              <span>100% Local · Seus dados não saem do navegador</span>
            </div>
          </div>
        </div>
      </header>

      <main class="w-full px-3 sm:px-6 py-4 sm:py-8">
        {/* Upload Section */}
        <section id="upload-section" class="mb-6 sm:mb-8">
          <div
            id="drop-zone"
            class="bg-white dark:bg-slate-800 rounded-xl shadow-md border-2 border-dashed border-blue-300 dark:border-blue-500 hover:border-blue-500 dark:hover:border-blue-400 transition-all p-6 sm:p-10 text-center cursor-pointer"
          >
            <i class="fas fa-cloud-upload-alt text-4xl sm:text-6xl text-blue-500 dark:text-blue-400 mb-4"></i>
            <h2 class="text-lg sm:text-xl font-semibold text-gray-800 dark:text-slate-100 mb-2">
              Envie seu extrato bancário
            </h2>
            <p class="text-gray-600 dark:text-slate-300 mb-4 text-sm sm:text-base">
              Arraste e solte um ou mais arquivos <strong>.ofx</strong> aqui ou clique para selecionar
            </p>
            <input type="file" id="file-input" accept=".ofx,.OFX" class="hidden" multiple />
            <button
              id="select-file-btn"
              class="bg-blue-600 hover:bg-blue-700 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-medium transition text-sm sm:text-base"
            >
              <i class="fas fa-folder-open mr-2"></i>Selecionar arquivos OFX
            </button>
            <p class="text-xs text-gray-500 dark:text-slate-400 mt-4">
              Você pode selecionar <strong>vários arquivos de uma vez</strong> — eles serão mesclados por ordem cronológica, com detecção de sobreposição/conflito.
            </p>
          </div>

          <div
            id="error-msg"
            class="hidden mt-4 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-200 px-4 py-3 rounded-lg"
          >
            <i class="fas fa-exclamation-triangle mr-2"></i>
            <span id="error-text"></span>
          </div>
        </section>

        {/* Dashboard */}
        <section id="dashboard" class="hidden">
          {/* Botão para anexar mais OFX (multi-file) */}
          <div id="append-ofx-wrapper" class="mb-4 sm:mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-800/70 dark:to-slate-800/40 border border-blue-200 dark:border-blue-800/60 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-3">
              <i class="fas fa-layer-group text-blue-600 dark:text-blue-400 text-xl"></i>
              <div>
                <div class="text-sm font-semibold text-gray-800 dark:text-slate-100">Anexar mais OFX</div>
                <div class="text-xs text-gray-600 dark:text-slate-400">
                  Junte outros extratos (períodos anteriores ou seguintes). Aceita <strong>vários arquivos por vez</strong>; datas fora de ordem são mescladas automaticamente e conflitos são detectados.
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <input type="file" id="append-file-input" accept=".ofx,.OFX" class="hidden" multiple />
              <button
                type="button"
                id="append-file-btn"
                class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition inline-flex items-center gap-2"
              >
                <i class="fas fa-plus"></i>
                <span>Adicionar OFX</span>
              </button>
            </div>
          </div>

          {/* Alerta de divergência entre extratos anexados */}
          <div id="append-alert" class="hidden mb-4 sm:mb-6 rounded-xl border p-4" role="alert"></div>

          {/* Lista de arquivos OFX carregados (aparece só quando há 2+) */}
          <div id="ofx-files-wrapper" class="hidden mb-4 sm:mb-6 bg-white dark:bg-slate-800 rounded-xl shadow-md p-4">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
                <i class="fas fa-folder-open text-blue-600 dark:text-blue-400"></i>
                Arquivos OFX carregados
              </h3>
              <span class="text-xs text-gray-500 dark:text-slate-400">
                Clique em <span class="font-semibold text-red-600 dark:text-red-400">Reverter</span> para desfazer um anexo
              </span>
            </div>
            <div id="ofx-files-list"></div>
          </div>

          {/* Account Info */}
          <div id="account-info" class="collapsible bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-base sm:text-lg font-bold text-gray-800 dark:text-slate-100">
                <i class="fas fa-university text-blue-600 dark:text-blue-400 mr-2"></i>
                Informações da Conta
              </h2>
              <button
                type="button"
                class="collapse-toggle text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-1"
                data-target="account-details-wrapper"
                aria-label="Recolher/expandir informações da conta"
              >
                <i class="fas fa-chevron-up"></i>
                <span class="hidden sm:inline text-xs">Recolher</span>
              </button>
            </div>
            <div id="account-details-wrapper" class="collapsible-body">
              <div id="account-details" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3 text-xs sm:text-sm justify-items-center text-center"></div>
            </div>
          </div>

          {/* Container reordenável dos blocos.  Os filhos diretos são
              blocos independentes (Cards de Resumo, Calculadora, Gráfico,
              Filtros, Movimentos, Transações). Cada um tem
              [data-block-id] para persistir a ordem no localStorage. */}
          <div id="dashboard-blocks">

          {/* Summary Cards */}
          <div class="draggable-block" data-block-id="summary">
          <div class="block-drag-handle" title="Arrastar para reordenar">
            <i class="fas fa-grip-vertical"></i>
            <span class="block-drag-label">Resumo</span>
          </div>
          <div class="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4 mb-4 sm:mb-6">
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md p-3 sm:p-5 border-l-4 border-blue-500">
              <div class="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400 uppercase font-semibold">Transações</div>
              <div id="stat-count" class="text-lg sm:text-2xl font-bold text-gray-800 dark:text-slate-100 mt-1">0</div>
              <div class="text-[10px] sm:text-xs text-gray-400 dark:text-slate-500 mt-1"><i class="fas fa-list"></i> registros</div>
            </div>
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md p-3 sm:p-5 border-l-4 border-green-500">
              <div class="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400 uppercase font-semibold">Créditos</div>
              <div id="stat-credit" class="text-base sm:text-2xl font-bold text-green-600 dark:text-green-400 mt-1">R$ 0,00</div>
              <div id="stat-credit-count" class="text-[10px] sm:text-xs text-gray-400 dark:text-slate-500 mt-1">0 entradas</div>
            </div>
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md p-3 sm:p-5 border-l-4 border-red-500">
              <div class="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400 uppercase font-semibold">Débitos</div>
              <div id="stat-debit" class="text-base sm:text-2xl font-bold text-red-600 dark:text-red-400 mt-1">R$ 0,00</div>
              <div id="stat-debit-count" class="text-[10px] sm:text-xs text-gray-400 dark:text-slate-500 mt-1">0 saídas</div>
            </div>
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md p-3 sm:p-5 border-l-4 border-indigo-500">
              <div class="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400 uppercase font-semibold">Saldo do Período</div>
              <div id="stat-balance" class="text-base sm:text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">R$ 0,00</div>
              <div class="text-[10px] sm:text-xs text-gray-400 dark:text-slate-500 mt-1">créditos - débitos</div>
            </div>
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md p-3 sm:p-5 border-l-4 border-purple-500 col-span-2 lg:col-span-1">
              <div class="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400 uppercase font-semibold">Valor Médio</div>
              <div id="stat-avg" class="text-base sm:text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">R$ 0,00</div>
              <div class="text-[10px] sm:text-xs text-gray-400 dark:text-slate-500 mt-1">média por transação</div>
            </div>
          </div>
          </div>{/* /summary block */}

          {/* Percentage Calculator v2 — layout padronizado e mais explicativo */}
          <div class="draggable-block" data-block-id="calc">
          <div class="block-drag-handle" title="Arrastar para reordenar">
            <i class="fas fa-grip-vertical"></i>
            <span class="block-drag-label">Calculadora</span>
          </div>
          <div class="collapsible bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
            <div class="flex items-center justify-between mb-3 sm:mb-4">
              <div class="flex items-baseline gap-2 flex-wrap">
                <h2 class="text-base sm:text-lg font-bold text-gray-800 dark:text-slate-100">
                  <i class="fas fa-calculator text-blue-600 dark:text-blue-400 mr-2"></i>Calculadora de Porcentagem
                </h2>
                <span class="text-xs text-gray-500 dark:text-slate-400 hidden sm:inline">
                  · rápida para conferência de valores
                </span>
              </div>
              <button
                type="button"
                class="collapse-toggle text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-1"
                data-target="calc-body"
              >
                <i class="fas fa-chevron-up"></i>
                <span class="hidden sm:inline text-xs">Recolher</span>
              </button>
            </div>
            <div id="calc-body" class="collapsible-body">
              {/* 3 blocos padronizados: (1) Operação  (2) Entradas  (3) Resultado */}
              <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* ── Bloco 1: Operação ─────────────────────────────── */}
                <div class="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/40 p-3">
                  <div class="calc-field-label mb-2"><i class="fas fa-cog mr-1"></i>Operação</div>
                  <select
                    id="calc-op"
                    class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="of">% de (quanto é X% do valor)</option>
                    <option value="add">Acrescentar % (juros / aumento)</option>
                    <option value="sub">Descontar % (desconto)</option>
                    <option value="ratio">Qual % (A é % de B)</option>
                  </select>
                  <div class="mt-2 text-[11px] text-gray-500 dark:text-slate-400 leading-4">
                    Escolha o que quer calcular. A ordem dos campos <b>Valor</b> e o rótulo mudam de acordo.
                  </div>
                </div>

                {/* ── Bloco 2: Entradas ─────────────────────────────── */}
                <div class="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/40 p-3">
                  <div class="calc-field-label mb-2"><i class="fas fa-keyboard mr-1"></i>Entradas</div>
                  <div class="calc-v2">
                    <div class="calc-field">
                      <label class="calc-field-label">Valor (R$)</label>
                      <input
                        type="text"
                        inputmode="decimal"
                        id="calc-value"
                        placeholder="10.000,00"
                        class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div class="calc-field">
                      <label class="calc-field-label" id="calc-second-label">Porcentagem (%)</label>
                      <input
                        type="text"
                        inputmode="decimal"
                        id="calc-percent"
                        placeholder="10"
                        class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div class="mt-2 text-[11px] text-gray-500 dark:text-slate-400 leading-4">
                    Aceita formato BR: <code class="bg-gray-200 dark:bg-slate-700 px-1 rounded">10.000,00</code>, <code class="bg-gray-200 dark:bg-slate-700 px-1 rounded">R$ 10.000,00</code>.
                  </div>
                </div>

                {/* ── Bloco 3: Resultado ────────────────────────────── */}
                <div class="rounded-lg border-2 border-blue-500/60 dark:border-blue-500/50 bg-blue-50/70 dark:bg-blue-900/25 p-3">
                  <div class="calc-result-label mb-1"><i class="fas fa-equals mr-1"></i>Resultado</div>
                  <div id="calc-result" class="calc-result-value text-blue-700 dark:text-blue-200">R$ 0,00</div>
                  {/* Detalhe R$ ↔ % — mostrado apenas na operação "Qual % (A é % de B)" */}
                  <div id="calc-detail" class="hidden mt-2 text-xs text-gray-600 dark:text-slate-300 leading-5 bg-white dark:bg-slate-900/40 border border-gray-200 dark:border-slate-700 rounded-md px-2.5 py-1.5"></div>
                </div>
              </div>

              {/* Dica com exemplo dinâmico (atualizada conforme operação escolhida) */}
              <div class="calc-hint-box mt-3">
                <i class="fas fa-lightbulb mr-1"></i>
                <span id="calc-hint">
                  Aceita valores no formato brasileiro: <code>10.000,00</code> ou <code>R$ 10.000,00</code>
                </span>
              </div>
            </div>
          </div>
          </div>{/* /calc block */}

          {/* Chart */}
          <div class="draggable-block" data-block-id="chart">
          <div class="block-drag-handle" title="Arrastar para reordenar">
            <i class="fas fa-grip-vertical"></i>
            <span class="block-drag-label">Evolução Diária</span>
          </div>
          <div class="collapsible bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
            <div class="flex items-center justify-between mb-3 sm:mb-4">
              <h2 class="text-base sm:text-lg font-bold text-gray-800 dark:text-slate-100">
                <i class="fas fa-chart-line text-blue-600 dark:text-blue-400 mr-2"></i>Evolução Diária
              </h2>
              <button
                type="button"
                class="collapse-toggle text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-1"
                data-target="chart-body"
              >
                <i class="fas fa-chevron-up"></i>
                <span class="hidden sm:inline text-xs">Recolher</span>
              </button>
            </div>
            <div id="chart-body" class="collapsible-body">
              <div class="h-56 sm:h-72">
                <canvas id="daily-chart"></canvas>
              </div>
            </div>
          </div>
          </div>{/* /chart block */}

          {/* Filters */}
          <div class="draggable-block" data-block-id="filters">
          <div class="block-drag-handle" title="Arrastar para reordenar">
            <i class="fas fa-grip-vertical"></i>
            <span class="block-drag-label">Filtros</span>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
            <div class="flex items-center justify-between flex-wrap gap-2 mb-3 sm:mb-4">
              <h2 class="text-base sm:text-lg font-bold text-gray-800 dark:text-slate-100">
                <i class="fas fa-filter text-blue-600 dark:text-blue-400 mr-2"></i>Filtros
              </h2>
              {/* Info do período máximo do OFX carregado */}
              <div id="filters-period-info" class="hidden text-xs sm:text-sm bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 rounded-lg px-3 py-1.5 flex items-center gap-2">
                <i class="fas fa-info-circle"></i>
                <span>Período do documento: <span id="filters-period-range" class="font-semibold"></span></span>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Tipo de Transação
                </label>
                <select
                  id="filter-type"
                  class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">Todas</option>
                  <option value="credit">Somente Créditos</option>
                  <option value="debit">Somente Débitos</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  <i class="fas fa-calendar-day text-blue-500 mr-1"></i>Data/Hora Inicial
                </label>
                {/* Wrapper com ícone de calendário dentro do bloco.
                    O input é do tipo TEXT — o usuário pode digitar livremente
                    a data no formato dd/mm/aaaa HH:MM. Clicar no ícone (ou no
                    input) abre o Flatpickr. */}
                <div class="datetime-input-wrapper">
                  <input
                    type="text"
                    id="filter-start"
                    class="filter-datetime"
                    placeholder="dd/mm/aaaa HH:MM"
                    autocomplete="off"
                  />
                  <button type="button" id="filter-start-cal" class="datetime-cal-btn" title="Abrir calendário" aria-label="Abrir calendário">
                    <i class="fas fa-calendar-alt"></i>
                  </button>
                </div>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  <i class="fas fa-calendar-check text-blue-500 mr-1"></i>Data/Hora Final
                </label>
                <div class="datetime-input-wrapper">
                  <input
                    type="text"
                    id="filter-end"
                    class="filter-datetime"
                    placeholder="dd/mm/aaaa HH:MM"
                    autocomplete="off"
                  />
                  <button type="button" id="filter-end-cal" class="datetime-cal-btn" title="Abrir calendário" aria-label="Abrir calendário">
                    <i class="fas fa-calendar-alt"></i>
                  </button>
                </div>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Buscar Descrição
                  <span
                    class="ml-1 text-blue-500 cursor-help"
                    title="Digite e pressione Enter (ou selecione da lista) para adicionar. Cada pill é um termo — clique nela para alternar entre INCLUIR (verde) e EXCLUIR (vermelho). X remove."
                  >
                    <i class="fas fa-question-circle"></i>
                  </span>
                </label>
                {/* Multi-select com pills + autocomplete inline. */}
                <div id="filter-search-wrapper" class="multiselect-wrapper" data-target="search">
                  <div class="multiselect-pills" id="filter-search-pills"></div>
                  <input
                    type="text"
                    id="filter-search"
                    placeholder="Digite palavra e Enter..."
                    autocomplete="off"
                    class="multiselect-input"
                  />
                  <div class="multiselect-suggestions" id="filter-search-suggestions"></div>
                </div>
                <p class="text-[10px] text-gray-500 dark:text-slate-400 mt-1 hidden sm:block">
                  <span class="text-emerald-500 font-semibold">Verde = incluir</span> · <span class="text-rose-500 font-semibold">Vermelho = excluir</span> · Clique na pill para alternar
                </p>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Conta Destino/Origem
                  <span
                    class="ml-1 text-blue-500 cursor-help"
                    title="Multi-seleção: escolha várias origens/destinos ao mesmo tempo. Clique numa pill para alternar entre INCLUIR (verde) e EXCLUIR (vermelho). O dropdown filtra as opções conforme você digita."
                  >
                    <i class="fas fa-question-circle"></i>
                  </span>
                </label>
                <div id="filter-counterparty-wrapper" class="multiselect-wrapper" data-target="counterparty">
                  <div class="multiselect-pills" id="filter-counterparty-pills"></div>
                  <input
                    type="text"
                    id="filter-counterparty"
                    placeholder="Digite ou clique para ver todas..."
                    autocomplete="off"
                    class="multiselect-input"
                  />
                  <div class="multiselect-suggestions" id="filter-counterparty-suggestions"></div>
                </div>
                <p class="text-[10px] text-gray-500 dark:text-slate-400 mt-1 hidden sm:block">
                  Selecione várias · Clique na pill para incluir/excluir
                </p>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Valor Mínimo (R$)
                </label>
                <input
                  type="text"
                  inputmode="decimal"
                  id="filter-min"
                  placeholder="0,00"
                  class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Valor Máximo (R$)
                </label>
                <input
                  type="text"
                  inputmode="decimal"
                  id="filter-max"
                  placeholder="0,00"
                  class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Ordenar por
                </label>
                <select
                  id="filter-sort"
                  class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="date-desc">Data (mais recente)</option>
                  <option value="date-asc">Data (mais antiga)</option>
                  <option value="value-desc">Valor (maior)</option>
                  <option value="value-asc">Valor (menor)</option>
                  <option value="desc-asc">Descrição (A-Z)</option>
                </select>
              </div>
            </div>

            {/* Filtro estorno + botões */}
            <div class="mt-4 flex flex-wrap items-center gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
              <div id="reversal-filter-wrapper" class="hidden">
                <label class="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-slate-200">
                  <select
                    id="filter-reversal"
                    class="border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">Todos (com e sem estornos)</option>
                    <option value="only">Somente estornos</option>
                    <option value="exclude">Ocultar estornos</option>
                  </select>
                  <span id="reversal-count-badge" class="text-xs bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-2 py-1 rounded-full">
                    <i class="fas fa-undo mr-1"></i><span id="reversal-count">0</span>
                  </span>
                </label>
              </div>
              <div id="devolucao-filter-wrapper" class="hidden">
                <label class="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-slate-200">
                  <select
                    id="filter-devolucao"
                    class="border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">Todos (com e sem devoluções PIX)</option>
                    <option value="only">Somente devoluções PIX</option>
                    <option value="exclude">Ocultar devoluções PIX</option>
                  </select>
                  <span id="devolucao-count-badge" class="text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-1 rounded-full">
                    <i class="fas fa-rotate-left mr-1"></i><span id="devolucao-count">0</span>
                  </span>
                </label>
              </div>
              <div id="boleto-filter-wrapper" class="hidden">
                <label class="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-slate-200">
                  <select
                    id="filter-boleto"
                    class="border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">Todos (com e sem boletos)</option>
                    <option value="only">Somente pagamento de boletos</option>
                    <option value="exclude">Ocultar pagamento de boletos</option>
                  </select>
                  <span id="boleto-count-badge" class="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full">
                    <i class="fas fa-barcode mr-1"></i><span id="boleto-count">0</span>
                  </span>
                </label>
              </div>
              <div class="flex-1"></div>
              <div class="flex flex-wrap gap-2">
                <button
                  id="clear-filters"
                  class="bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium"
                >
                  <i class="fas fa-eraser mr-1"></i>Limpar
                </button>
              </div>
            </div>
          </div>
          </div>{/* /filters block */}

          {/* Counterparty Panel */}
          <div class="draggable-block" data-block-id="movements">
          <div class="block-drag-handle" title="Arrastar para reordenar">
            <i class="fas fa-grip-vertical"></i>
            <span class="block-drag-label">Movimentos</span>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 class="text-base sm:text-lg font-bold text-gray-800 dark:text-slate-100">
                <i class="fas fa-exchange-alt text-blue-600 dark:text-blue-400 mr-2"></i>
                Movimentos
                <span
                  id="counterparty-count"
                  class="ml-2 text-xs sm:text-sm font-normal text-gray-500 dark:text-slate-400"
                ></span>
              </h2>
              <div class="flex items-center gap-2 flex-wrap">
                <button
                  id="counterparty-toggle"
                  class="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800"
                >
                  <i class="fas fa-chevron-up"></i>
                  <span class="ml-1 hidden sm:inline">Recolher</span>
                </button>
              </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-slate-400 mb-2">
              Clique em <span class="text-green-400 font-semibold">Créditos</span> ou <span class="text-red-400 font-semibold">Débitos</span> para filtrar a tabela por tipo. Para ver as contrapartes individuais, use o filtro <strong>Conta Destino/Origem</strong>.
            </p>
            {/* Totais gerais (sempre visíveis, independentes do filtro) */}
            <div
              id="counterparty-totals"
              class="text-sm mb-3 min-h-[1.25rem] flex items-center flex-wrap"
            ></div>
            {/* Painel simplificado: 2 cards (Créditos, Débitos) */}
            <div
              id="counterparty-panel"
              class="grid grid-cols-1 sm:grid-cols-2 gap-3"
            ></div>
          </div>
          </div>{/* /movements block */}

          {/* Transactions Table */}
          <div class="draggable-block" data-block-id="transactions">
          <div class="block-drag-handle" title="Arrastar para reordenar">
            <i class="fas fa-grip-vertical"></i>
            <span class="block-drag-label">Transações</span>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md">
            <div class="p-4 sm:p-6 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-3 rounded-t-xl">
              <h2 class="text-base sm:text-lg font-bold text-gray-800 dark:text-slate-100">
                <i class="fas fa-list-ul text-blue-600 dark:text-blue-400 mr-2"></i>Transações
                <span
                  id="filtered-count"
                  class="ml-2 text-xs sm:text-sm font-normal text-gray-500 dark:text-slate-400"
                ></span>
                <span
                  id="selection-count"
                  class="hidden ml-2 text-xs sm:text-sm font-normal text-blue-600 dark:text-blue-400"
                ></span>
              </h2>
              <div class="flex items-center gap-2 flex-wrap">
                <button
                  id="clear-selection"
                  class="hidden bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200 px-2 py-1 rounded-lg text-xs"
                  title="Limpar seleção"
                >
                  <i class="fas fa-times mr-1"></i>Limpar seleção
                </button>
                <label class="text-xs font-semibold text-gray-600 dark:text-slate-300">Por página:</label>
                <select
                  id="page-size"
                  class="border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="100">100</option>
                  <option value="150">150</option>
                  <option value="200">200</option>
                  <option value="250">250</option>
                  <option value="300">300</option>
                  <option value="350">350</option>
                  <option value="450">450</option>
                  <option value="500">500</option>
                </select>
                <button
                  id="export-csv"
                  class="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                  title="Exportar transações filtradas para CSV"
                >
                  <i class="fas fa-file-csv mr-1"></i>CSV
                </button>
                <button
                  id="export-pdf"
                  class="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                  title="Exportar transações filtradas para PDF"
                >
                  <i class="fas fa-file-pdf mr-1"></i>PDF
                </button>
              </div>
            </div>

            {/* Desktop table — grid completo (linhas horizontais + verticais)
                e cabeçalho STICKY (acompanha o scroll da página). */}
            <div class="hidden sm:block">
              <table class="w-full transactions-table">
                <thead class="transactions-thead bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700">
                  <tr>
                    <th class="text-center px-2 py-3 w-10">
                      <input type="checkbox" id="select-all-header" class="rounded border-gray-300 dark:border-slate-500 text-blue-600 focus:ring-blue-500 cursor-pointer" title="Selecionar/desmarcar todos" />
                    </th>
                    <th class="text-center px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase whitespace-nowrap">Data/Hora</th>
                    <th class="text-center px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Tipo</th>
                    <th class="text-center px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Descrição</th>
                    <th class="text-center px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Conta Destino/Origem</th>
                    <th class="text-center px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase" title="Nome do destinatário original da transação estornada/devolvida">Destinatário Estorno</th>

                    <th class="text-center px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase whitespace-nowrap">Valor</th>
                    <th class="text-center px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase whitespace-nowrap">Saldo Antes</th>
                    <th class="text-center px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase whitespace-nowrap">Saldo Após</th>
                  </tr>
                </thead>
                <tbody id="transactions-tbody" class="divide-y divide-gray-100 dark:divide-slate-700"></tbody>
                <tfoot class="bg-gray-50 dark:bg-slate-900 border-t-2 border-gray-200 dark:border-slate-700">
                  <tr>
                    <td colspan="7" class="px-3 py-3 text-right font-semibold text-gray-700 dark:text-slate-200">
                      Total filtrado<span id="filtered-total-label">:</span>
                    </td>
                    <td id="filtered-total" class="px-3 py-3 text-center font-bold text-gray-900 dark:text-slate-100">
                      R$ 0,00
                    </td>
                    <td colspan="2" class="px-3 py-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile cards */}
            <div id="transactions-mobile" class="sm:hidden divide-y divide-gray-100 dark:divide-slate-700"></div>
            <div class="sm:hidden bg-gray-50 dark:bg-slate-900 border-t-2 border-gray-200 dark:border-slate-700 px-4 py-3 flex justify-between font-semibold text-sm">
              <span class="text-gray-700 dark:text-slate-200">Total filtrado<span id="filtered-total-label-mobile">:</span></span>
              <span id="filtered-total-mobile" class="text-gray-900 dark:text-slate-100">R$ 0,00</span>
            </div>

            <div id="empty-state" class="hidden p-8 sm:p-12 text-center text-gray-500 dark:text-slate-400">
              <i class="fas fa-inbox text-3xl sm:text-4xl mb-3"></i>
              <p>Nenhuma transação encontrada com os filtros aplicados.</p>
            </div>

            {/* Botão "Carregar mais" — carrega a próxima página abaixo da
                lista atual (append), sem navegar. Fica visível se houver
                mais páginas depois da atual. */}
            <div id="load-more-wrapper" class="hidden border-t border-gray-200 dark:border-slate-700 px-4 sm:px-6 py-3 flex items-center justify-center">
              <button
                id="load-more-btn"
                type="button"
                class="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
              >
                <i class="fas fa-arrow-down"></i>
                <span id="load-more-label">Carregar mais</span>
              </button>
            </div>

            {/* Paginação */}
            <div
              id="pagination"
              class="hidden border-t border-gray-200 dark:border-slate-700 px-4 sm:px-6 py-3 sm:py-4 items-center justify-between flex-wrap gap-3"
            >
              <div id="pagination-info" class="text-xs sm:text-sm text-gray-600 dark:text-slate-400"></div>
              <div class="flex items-center gap-1">
                <button id="page-first" class="px-2 sm:px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed" title="Primeira">
                  <i class="fas fa-angle-double-left"></i>
                </button>
                <button id="page-prev" class="px-2 sm:px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed" title="Anterior">
                  <i class="fas fa-angle-left"></i>
                </button>
                <span id="page-indicator" class="px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-slate-200"></span>
                <button id="page-next" class="px-2 sm:px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed" title="Próxima">
                  <i class="fas fa-angle-right"></i>
                </button>
                <button id="page-last" class="px-2 sm:px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed" title="Última">
                  <i class="fas fa-angle-double-right"></i>
                </button>
              </div>
            </div>
          </div>
          </div>{/* /transactions block */}

          </div>{/* /dashboard-blocks */}
        </section>
      </main>

      {/* Modal de Prévia de Exportação (PDF / CSV) */}
      <div
        id="export-preview-modal"
        class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
      >
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden border border-gray-200 dark:border-slate-700">
          {/* Header do modal */}
          <div class="px-5 sm:px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-gradient-to-r from-blue-700 to-indigo-800 dark:from-slate-900 dark:to-slate-800 text-white flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-3">
              <i id="export-modal-icon" class="fas fa-file-pdf text-2xl"></i>
              <div>
                <h3 id="export-modal-title" class="text-base sm:text-lg font-bold leading-tight">
                  Prévia de Exportação
                </h3>
                <p id="export-modal-subtitle" class="text-xs sm:text-sm text-blue-100 dark:text-slate-300">
                  Revise os dados antes de baixar o arquivo
                </p>
              </div>
            </div>
            <button
              id="export-modal-close"
              type="button"
              class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 transition"
              title="Fechar (Esc)"
              aria-label="Fechar modal"
            >
              <i class="fas fa-times text-lg"></i>
            </button>
          </div>

          {/* Meta / resumo */}
          <div class="px-5 sm:px-6 py-3 bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs sm:text-sm">
            <div>
              <div class="text-[10px] uppercase font-semibold text-gray-500 dark:text-slate-400">Transações</div>
              <div id="preview-meta-count" class="font-bold text-gray-800 dark:text-slate-100">0</div>
            </div>
            <div>
              <div class="text-[10px] uppercase font-semibold text-gray-500 dark:text-slate-400">Créditos</div>
              <div id="preview-meta-credits" class="font-bold text-green-600 dark:text-green-400">R$ 0,00</div>
            </div>
            <div>
              <div class="text-[10px] uppercase font-semibold text-gray-500 dark:text-slate-400">Débitos</div>
              <div id="preview-meta-debits" class="font-bold text-red-600 dark:text-red-400">R$ 0,00</div>
            </div>
            <div>
              <div class="text-[10px] uppercase font-semibold text-gray-500 dark:text-slate-400">Saldo</div>
              <div id="preview-meta-balance" class="font-bold text-indigo-600 dark:text-indigo-400">R$ 0,00</div>
            </div>
          </div>

          {/* Corpo scrollável com prévia */}
          <div class="flex-1 overflow-auto px-5 sm:px-6 py-4">
            <div id="preview-body" class="text-xs sm:text-sm"></div>
          </div>

          {/* Rodapé com ações */}
          <div class="px-5 sm:px-6 py-4 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 flex items-center justify-between flex-wrap gap-3">
            <div class="text-xs text-gray-500 dark:text-slate-400">
              <i class="fas fa-info-circle mr-1"></i>
              <span id="preview-footer-hint">O arquivo será baixado após confirmar</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                id="export-modal-cancel"
                type="button"
                class="px-4 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200 transition"
              >
                <i class="fas fa-times mr-1"></i>Cancelar
              </button>
              <button
                id="export-modal-confirm"
                type="button"
                class="px-4 py-2 rounded-lg text-sm font-semibold text-white transition bg-blue-600 hover:bg-blue-700"
              >
                <i class="fas fa-download mr-1"></i>
                <span id="export-modal-confirm-label">Baixar</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer class="text-center text-gray-500 dark:text-slate-400 text-xs sm:text-sm py-6 px-4">
        <p>
          <i class="fas fa-lock mr-1"></i>
          Todo o processamento é feito localmente no seu navegador. Nenhum dado é
          enviado para servidores.
        </p>
      </footer>

      {/* Bibliotecas para PDF */}
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
      <script src="/static/app.js"></script>
    </>
  )
})

export default app
