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
              Arraste e solte o arquivo <strong>.ofx</strong> aqui ou clique para
              selecionar
            </p>
            <input type="file" id="file-input" accept=".ofx,.OFX" class="hidden" />
            <button
              id="select-file-btn"
              class="bg-blue-600 hover:bg-blue-700 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-medium transition text-sm sm:text-base"
            >
              <i class="fas fa-folder-open mr-2"></i>Selecionar Arquivo OFX
            </button>
            <p class="text-xs text-gray-500 dark:text-slate-400 mt-4">
              Formatos suportados: OFX (Open Financial Exchange) - padrão de extratos
              bancários brasileiros
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

          {/* Summary Cards */}
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
              <div class="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400 uppercase font-semibold">Ticket Médio</div>
              <div id="stat-avg" class="text-base sm:text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">R$ 0,00</div>
              <div class="text-[10px] sm:text-xs text-gray-400 dark:text-slate-500 mt-1">valor médio</div>
            </div>
          </div>

          {/* Percentage Calculator */}
          <div class="collapsible bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
            <div class="flex items-center justify-between mb-3 sm:mb-4">
              <h2 class="text-base sm:text-lg font-bold text-gray-800 dark:text-slate-100">
                <i class="fas fa-calculator text-blue-600 dark:text-blue-400 mr-2"></i>Calculadora de Porcentagem
              </h2>
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
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Valor (R$)
                </label>
                <input
                  type="text"
                  inputmode="decimal"
                  id="calc-value"
                  placeholder="10.000,00"
                  class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Operação
                </label>
                <select
                  id="calc-op"
                  class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="of">% de (X% do valor)</option>
                  <option value="add">Acrescentar % (juros/aumento)</option>
                  <option value="sub">Descontar % (desconto)</option>
                  <option value="ratio">Qual % (A é % de B)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  <span id="calc-second-label">Porcentagem (%)</span>
                </label>
                <input
                  type="text"
                  inputmode="decimal"
                  id="calc-percent"
                  placeholder="10"
                  class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Resultado
                </label>
                <div
                  id="calc-result"
                  class="w-full border-2 border-blue-500 bg-blue-50 dark:bg-blue-900/40 rounded-lg px-3 py-2 text-base sm:text-lg font-bold text-blue-700 dark:text-blue-300"
                >
                  R$ 0,00
                </div>
              </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-slate-400 mt-3">
              <i class="fas fa-info-circle mr-1"></i>
              <span id="calc-hint">
                Aceita valores no formato brasileiro: <code class="bg-gray-100 dark:bg-slate-700 px-1 rounded">10.000,00</code> ou <code class="bg-gray-100 dark:bg-slate-700 px-1 rounded">R$ 10.000,00</code>
              </span>
            </p>
            </div>
          </div>

          {/* Chart */}
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

          {/* Filters */}
          <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
            <h2 class="text-base sm:text-lg font-bold text-gray-800 dark:text-slate-100 mb-3 sm:mb-4">
              <i class="fas fa-filter text-blue-600 dark:text-blue-400 mr-2"></i>Filtros
            </h2>
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
                <input
                  type="datetime-local"
                  id="filter-start"
                  step="60"
                  class="filter-datetime"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  <i class="fas fa-calendar-check text-blue-500 mr-1"></i>Data/Hora Final
                </label>
                <input
                  type="datetime-local"
                  id="filter-end"
                  step="60"
                  class="filter-datetime"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Buscar Descrição
                  <span
                    class="ml-1 text-blue-500 cursor-help"
                    title='Busca combinada: separe palavras por espaço (todas devem existir). Use "frase entre aspas" para busca exata. Use -palavra para excluir.'
                  >
                    <i class="fas fa-question-circle"></i>
                  </span>
                </label>
                <input
                  type="text"
                  id="filter-search"
                  placeholder='pix maria  |  "netflix"  |  pix -reembolso'
                  class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p class="text-[10px] text-gray-500 dark:text-slate-400 mt-1 hidden sm:block">
                  Múltiplas palavras: <code class="bg-gray-100 dark:bg-slate-700 px-1">todas</code> · <code class="bg-gray-100 dark:bg-slate-700 px-1">"aspas"</code> = exata · <code class="bg-gray-100 dark:bg-slate-700 px-1">-palavra</code> = excluir
                </p>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                  Conta Destino/Origem
                </label>
                <div id="filter-counterparty-wrapper" class="input-clearable-wrapper">
                  <input
                    type="text"
                    id="filter-counterparty"
                    list="counterparty-list"
                    placeholder="Digite ou selecione ao lado..."
                    autocomplete="off"
                    class="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    id="filter-counterparty-clear"
                    class="input-clear-btn"
                    title="Limpar seleção"
                    aria-label="Limpar conta destino/origem"
                  >
                    <i class="fas fa-eraser"></i>
                  </button>
                </div>
                <datalist id="counterparty-list"></datalist>
                <p class="text-[10px] text-gray-500 dark:text-slate-400 mt-1 hidden sm:block">
                  Sincronizado com o tipo de transação
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
                    <option value="only">Somente estornos/devoluções</option>
                    <option value="exclude">Ocultar estornos/devoluções</option>
                  </select>
                  <span id="reversal-count-badge" class="text-xs bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-2 py-1 rounded-full">
                    <i class="fas fa-undo mr-1"></i><span id="reversal-count">0</span>
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
                <button
                  id="export-csv"
                  class="bg-green-600 hover:bg-green-700 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium"
                >
                  <i class="fas fa-file-csv mr-1"></i>CSV
                </button>
                <button
                  id="export-pdf"
                  class="bg-red-600 hover:bg-red-700 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium"
                >
                  <i class="fas fa-file-pdf mr-1"></i>PDF
                </button>
              </div>
            </div>
          </div>

          {/* Counterparty Panel */}
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

          {/* Transactions Table */}
          <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md overflow-hidden">
            <div class="p-4 sm:p-6 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-3">
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
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                </select>
              </div>
            </div>

            {/* Desktop table */}
            <div class="overflow-x-auto hidden sm:block">
              <table class="w-full">
                <thead class="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700">
                  <tr>
                    <th class="text-center px-2 py-3 w-10">
                      <input type="checkbox" id="select-all-header" class="rounded border-gray-300 dark:border-slate-500 text-blue-600 focus:ring-blue-500 cursor-pointer" title="Selecionar/desmarcar todos" />
                    </th>
                    <th class="text-left px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase whitespace-nowrap">Data/Hora</th>
                    <th class="text-left px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Tipo</th>
                    <th class="text-left px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Descrição</th>
                    <th class="text-left px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Conta Destino/Origem</th>
                    <th class="text-left px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase" title="Nome do destinatário original da transação estornada/devolvida">Destinatário Estorno</th>
                    <th class="text-left px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase" title="EndToEndId (REFNUM do OFX, é o que aparece no comprovante BACEN) e TxId (FITID do OFX)">TxId / EndToEnd</th>
                    <th class="text-right px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase whitespace-nowrap">Valor</th>
                    <th class="text-right px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase whitespace-nowrap">Saldo Antes</th>
                    <th class="text-right px-3 py-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase whitespace-nowrap">Saldo Após</th>
                  </tr>
                </thead>
                <tbody id="transactions-tbody" class="divide-y divide-gray-100 dark:divide-slate-700"></tbody>
                <tfoot class="bg-gray-50 dark:bg-slate-900 border-t-2 border-gray-200 dark:border-slate-700">
                  <tr>
                    <td colspan="7" class="px-3 py-3 text-right font-semibold text-gray-700 dark:text-slate-200">
                      Total filtrado<span id="filtered-total-label">:</span>
                    </td>
                    <td id="filtered-total" class="px-3 py-3 text-right font-bold text-gray-900 dark:text-slate-100">
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
