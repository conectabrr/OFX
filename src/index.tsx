import { Hono } from 'hono'
import { renderer } from './renderer'

const app = new Hono()

app.use(renderer)

app.get('/', (c) => {
  return c.render(
    <>
      {/* Header */}
      <header class="bg-gradient-to-r from-blue-700 to-indigo-800 text-white shadow-lg">
        <div class="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <i class="fas fa-file-invoice-dollar text-3xl"></i>
            <div>
              <h1 class="text-2xl font-bold">Leitor de Extrato OFX</h1>
              <p class="text-blue-100 text-sm">
                Análise de transações bancárias com filtros avançados
              </p>
            </div>
          </div>
          <div class="hidden md:flex items-center gap-2 text-sm bg-white/10 px-3 py-2 rounded-lg">
            <i class="fas fa-shield-alt"></i>
            <span>100% Local · Seus dados não saem do navegador</span>
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-4 py-8">
        {/* Upload Section */}
        <section id="upload-section" class="mb-8">
          <div
            id="drop-zone"
            class="bg-white rounded-xl shadow-md border-2 border-dashed border-blue-300 hover:border-blue-500 transition-all p-10 text-center cursor-pointer"
          >
            <i class="fas fa-cloud-upload-alt text-6xl text-blue-500 mb-4"></i>
            <h2 class="text-xl font-semibold text-gray-800 mb-2">
              Envie seu extrato bancário
            </h2>
            <p class="text-gray-600 mb-4">
              Arraste e solte o arquivo <strong>.ofx</strong> aqui ou clique para
              selecionar
            </p>
            <input type="file" id="file-input" accept=".ofx,.OFX" class="hidden" />
            <button
              id="select-file-btn"
              class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition"
            >
              <i class="fas fa-folder-open mr-2"></i>Selecionar Arquivo OFX
            </button>
            <p class="text-xs text-gray-500 mt-4">
              Formatos suportados: OFX (Open Financial Exchange) - padrão de extratos
              bancários brasileiros
            </p>
          </div>

          <div id="error-msg" class="hidden mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            <span id="error-text"></span>
          </div>
        </section>

        {/* Dashboard - Hidden until file loaded */}
        <section id="dashboard" class="hidden">
          {/* Account Info */}
          <div id="account-info" class="bg-white rounded-xl shadow-md p-6 mb-6">
            <div class="flex items-start justify-between flex-wrap gap-4">
              <div>
                <h2 class="text-lg font-bold text-gray-800 mb-3">
                  <i class="fas fa-university text-blue-600 mr-2"></i>
                  Informações da Conta
                </h2>
                <div id="account-details" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm"></div>
              </div>
              <button
                id="reset-btn"
                class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm"
              >
                <i class="fas fa-redo mr-2"></i>Carregar outro arquivo
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          <div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <div class="bg-white rounded-xl shadow-md p-5 border-l-4 border-blue-500">
              <div class="text-xs text-gray-500 uppercase font-semibold">Transações</div>
              <div id="stat-count" class="text-2xl font-bold text-gray-800 mt-1">0</div>
              <div class="text-xs text-gray-400 mt-1">
                <i class="fas fa-list"></i> registros
              </div>
            </div>
            <div class="bg-white rounded-xl shadow-md p-5 border-l-4 border-green-500">
              <div class="text-xs text-gray-500 uppercase font-semibold">Créditos</div>
              <div id="stat-credit" class="text-2xl font-bold text-green-600 mt-1">R$ 0,00</div>
              <div id="stat-credit-count" class="text-xs text-gray-400 mt-1">0 entradas</div>
            </div>
            <div class="bg-white rounded-xl shadow-md p-5 border-l-4 border-red-500">
              <div class="text-xs text-gray-500 uppercase font-semibold">Débitos</div>
              <div id="stat-debit" class="text-2xl font-bold text-red-600 mt-1">R$ 0,00</div>
              <div id="stat-debit-count" class="text-xs text-gray-400 mt-1">0 saídas</div>
            </div>
            <div class="bg-white rounded-xl shadow-md p-5 border-l-4 border-indigo-500">
              <div class="text-xs text-gray-500 uppercase font-semibold">Saldo do Período</div>
              <div id="stat-balance" class="text-2xl font-bold text-indigo-600 mt-1">R$ 0,00</div>
              <div class="text-xs text-gray-400 mt-1">créditos - débitos</div>
            </div>
            <div class="bg-white rounded-xl shadow-md p-5 border-l-4 border-purple-500 col-span-2 lg:col-span-1">
              <div class="text-xs text-gray-500 uppercase font-semibold">Ticket Médio</div>
              <div id="stat-avg" class="text-2xl font-bold text-purple-600 mt-1">R$ 0,00</div>
              <div class="text-xs text-gray-400 mt-1">valor médio</div>
            </div>
          </div>

          {/* Percentage Calculator */}
          <div class="bg-white rounded-xl shadow-md p-6 mb-6">
            <h2 class="text-lg font-bold text-gray-800 mb-4">
              <i class="fas fa-calculator text-blue-600 mr-2"></i>Calculadora de Porcentagem
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Valor (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  id="calc-value"
                  placeholder="1000,00"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Operação
                </label>
                <select
                  id="calc-op"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="of">% de (X% do valor)</option>
                  <option value="add">Acrescentar % (juros/aumento)</option>
                  <option value="sub">Descontar % (desconto)</option>
                  <option value="ratio">Qual % (A é % de B)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  <span id="calc-second-label">Porcentagem (%)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  id="calc-percent"
                  placeholder="10"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Resultado
                </label>
                <div
                  id="calc-result"
                  class="w-full border-2 border-blue-500 bg-blue-50 rounded-lg px-3 py-2 text-lg font-bold text-blue-700"
                >
                  R$ 0,00
                </div>
              </div>
            </div>
            <p class="text-xs text-gray-500 mt-3">
              <i class="fas fa-info-circle mr-1"></i>
              <span id="calc-hint">
                Ex.: 10% de R$ 1.000,00 = R$ 100,00. Também pode calcular acréscimos, descontos ou qual porcentagem um valor representa de outro.
              </span>
            </p>
          </div>

          {/* Chart */}
          <div class="bg-white rounded-xl shadow-md p-6 mb-6">
            <h2 class="text-lg font-bold text-gray-800 mb-4">
              <i class="fas fa-chart-line text-blue-600 mr-2"></i>Evolução Diária
            </h2>
            <div style="height: 300px;">
              <canvas id="daily-chart"></canvas>
            </div>
          </div>

          {/* Filters */}
          <div class="bg-white rounded-xl shadow-md p-6 mb-6">
            <h2 class="text-lg font-bold text-gray-800 mb-4">
              <i class="fas fa-filter text-blue-600 mr-2"></i>Filtros
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Tipo de Transação
                </label>
                <select
                  id="filter-type"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">Todas</option>
                  <option value="credit">Somente Créditos</option>
                  <option value="debit">Somente Débitos</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Data/Hora Inicial
                </label>
                <input
                  type="datetime-local"
                  id="filter-start"
                  step="60"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Data/Hora Final
                </label>
                <input
                  type="datetime-local"
                  id="filter-end"
                  step="60"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
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
                  placeholder='Ex: pix maria  |  "netflix"  |  pix -reembolso'
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p class="text-[10px] text-gray-500 mt-1">
                  Múltiplas palavras: <code class="bg-gray-100 px-1">todas</code> devem existir · <code class="bg-gray-100 px-1">"aspas"</code> = frase exata · <code class="bg-gray-100 px-1">-palavra</code> = excluir
                </p>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Conta Destino/Origem
                </label>
                <input
                  type="text"
                  id="filter-counterparty"
                  list="counterparty-list"
                  placeholder="Digite ou selecione ao lado..."
                  autocomplete="off"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <datalist id="counterparty-list"></datalist>
                <p class="text-[10px] text-gray-500 mt-1">
                  Digite parte do nome, agência ou conta (aceita múltiplas palavras)
                </p>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Valor Mínimo (R$)
                </label>
                <input
                  type="number"
                  id="filter-min"
                  step="0.01"
                  placeholder="0,00"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Valor Máximo (R$)
                </label>
                <input
                  type="number"
                  id="filter-max"
                  step="0.01"
                  placeholder="0,00"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-600 mb-1">
                  Ordenar por
                </label>
                <select
                  id="filter-sort"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="date-desc">Data (mais recente)</option>
                  <option value="date-asc">Data (mais antiga)</option>
                  <option value="value-desc">Valor (maior)</option>
                  <option value="value-asc">Valor (menor)</option>
                  <option value="desc-asc">Descrição (A-Z)</option>
                </select>
              </div>
              <div class="flex items-end gap-2">
                <button
                  id="clear-filters"
                  class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
                >
                  <i class="fas fa-eraser mr-1"></i>Limpar
                </button>
                <button
                  id="export-csv"
                  class="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  <i class="fas fa-file-csv mr-1"></i>CSV
                </button>
              </div>
            </div>
          </div>

          {/* Counterparty Panel - Lista de destinos/origens */}
          <div class="bg-white rounded-xl shadow-md p-6 mb-6">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-lg font-bold text-gray-800">
                <i class="fas fa-address-book text-blue-600 mr-2"></i>
                Contrapartes (destinos e origens)
                <span
                  id="counterparty-count"
                  class="ml-2 text-sm font-normal text-gray-500"
                ></span>
              </h2>
              <button
                id="counterparty-toggle"
                class="text-sm text-blue-600 hover:text-blue-800"
              >
                <i class="fas fa-chevron-up"></i>
                <span class="ml-1">Recolher</span>
              </button>
            </div>
            <p class="text-xs text-gray-500 mb-3">
              Clique em uma contraparte para filtrar as transações. Clique novamente para remover o filtro.
            </p>
            <div
              id="counterparty-panel"
              class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-64 overflow-y-auto"
            ></div>
          </div>

          {/* Transactions Table */}
          <div class="bg-white rounded-xl shadow-md overflow-hidden">
            <div class="p-6 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
              <h2 class="text-lg font-bold text-gray-800">
                <i class="fas fa-list-ul text-blue-600 mr-2"></i>Transações
                <span
                  id="filtered-count"
                  class="ml-2 text-sm font-normal text-gray-500"
                ></span>
              </h2>
              <div class="flex items-center gap-2">
                <label class="text-xs font-semibold text-gray-600">Por página:</label>
                <select
                  id="page-size"
                  class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="100">100</option>
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                </select>
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full">
                <thead class="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th class="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">
                      Data
                    </th>
                    <th class="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">
                      Tipo
                    </th>
                    <th class="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">
                      Descrição
                    </th>
                    <th class="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">
                      Conta Destino/Origem
                    </th>
                    <th class="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">
                      Documento
                    </th>
                    <th class="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase">
                      Valor
                    </th>
                  </tr>
                </thead>
                <tbody id="transactions-tbody" class="divide-y divide-gray-100"></tbody>
                <tfoot class="bg-gray-50 border-t-2 border-gray-200">
                  <tr>
                    <td colspan="5" class="px-4 py-3 text-right font-semibold text-gray-700">
                      Total filtrado:
                    </td>
                    <td id="filtered-total" class="px-4 py-3 text-right font-bold text-gray-900">
                      R$ 0,00
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div
              id="empty-state"
              class="hidden p-12 text-center text-gray-500"
            >
              <i class="fas fa-inbox text-4xl mb-3"></i>
              <p>Nenhuma transação encontrada com os filtros aplicados.</p>
            </div>

            {/* Paginação */}
            <div
              id="pagination"
              class="hidden border-t border-gray-200 px-6 py-4 flex items-center justify-between flex-wrap gap-3"
            >
              <div id="pagination-info" class="text-sm text-gray-600"></div>
              <div class="flex items-center gap-1">
                <button
                  id="page-first"
                  class="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Primeira"
                >
                  <i class="fas fa-angle-double-left"></i>
                </button>
                <button
                  id="page-prev"
                  class="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Anterior"
                >
                  <i class="fas fa-angle-left"></i>
                </button>
                <span id="page-indicator" class="px-3 py-1.5 text-sm font-medium text-gray-700"></span>
                <button
                  id="page-next"
                  class="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Próxima"
                >
                  <i class="fas fa-angle-right"></i>
                </button>
                <button
                  id="page-last"
                  class="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Última"
                >
                  <i class="fas fa-angle-double-right"></i>
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer class="text-center text-gray-500 text-sm py-6">
        <p>
          <i class="fas fa-lock mr-1"></i>
          Todo o processamento é feito localmente no seu navegador. Nenhum dado é
          enviado para servidores.
        </p>
      </footer>

      <script src="/static/app.js"></script>
    </>
  )
})

export default app
