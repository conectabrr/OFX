# Leitor de Extrato Bancário OFX & PDF

## Visão Geral
- **Nome**: Leitor de Extrato OFX & PDF
- **Objetivo**: Sistema web para leitura e análise de extratos bancários em formato **OFX** (Open Financial Exchange, recomendado) e **PDF** (experimental, cobre extratos textuais dos principais bancos brasileiros)
- **Diferencial**: Processamento 100% local no navegador — nenhum dado bancário é enviado para servidores

> **Nota sobre o formato**: A solicitação original mencionava "pfx", porém PFX é formato de certificado digital. O formato correto e recomendado para extratos bancários é **OFX** (Open Financial Exchange), que é o adotado pela maioria dos bancos brasileiros para exportação de extratos. O suporte a **PDF** foi adicionado como conveniência para quando o OFX não estiver disponível.

## URLs
- **Sandbox (desenvolvimento)**: https://3000-ieuqgzbrndccyipebk6dr-b237eb32.sandbox.novita.ai
- **Arquivo OFX de exemplo**: `/exemplo.ofx` (download disponível para teste)
- **Arquivo PDF de exemplo**: `/exemplo-extrato.pdf` (13 transações, 3 estornos)
- **Produção**: (não deployado ainda)

## Funcionalidades Implementadas

### 📤 Upload
- Upload por drag-and-drop ou seleção manual
- Detecção automática de encoding ISO-8859-1 (padrão dos bancos brasileiros)
- Suporte a **OFX** SGML (v1.x) e XML (v2.x) — formato recomendado
- Suporte a **PDF** (experimental) — parser genérico de extratos brasileiros

### 📄 Suporte a PDF (Experimental)
Extratos em PDF são convertidos para transações usando **pdf.js** (Mozilla) direto no navegador, sem envio ao servidor.

**Como funciona o parser:**
- pdf.js extrai texto com **coordenadas X/Y** de cada página
- Linhas são reconstruídas agrupando itens por **posição Y** (tolerância ±3px)
- Detecção automática de **banco emissor** por padrões (Nubank, Itaú, Bradesco, BB, Caixa, Santander, Inter, C6, BTG, PicPay, Sicoob, Sicredi, Original, Mercado Pago, Next) + fallback genérico para "BANCO ... - CÓDIGO"
- Extração de **agência, conta e saldo final** por regex sobre o cabeçalho
- Cada linha iniciada por data (`dd/mm/yyyy`, `dd/mm/yy` ou `dd/mm`) é analisada como transação
- **Detecção inteligente de coluna VALOR vs SALDO**: quando a linha tem dois valores monetários, o parser usa flag D/C ou heurística "primeiro valor = transação, último = saldo"
- Filtro automático de linhas **SALDO ANTERIOR / SALDO FINAL / TOTAL** para não contá-las como transações
- Detecção de **estornos** (ESTORNO, DEVOLUÇÃO, REEMBOLSO, CANCELAMENTO, CHARGEBACK) por palavras-chave
- Suporta formato brasileiro (`1.234,56 D/C`) e contábil (`(1.234,56)` = negativo)

**Fluxo de importação (com preview obrigatório):**
1. Usuário seleciona ou arrasta um PDF
2. Aviso amarelo destacado: *"Parser PDF é experimental — resultado pode variar por banco"*
3. Spinner de progresso "processando página X/Y"
4. Modal de **preview** abre com:
   - Cards de metadados: banco detectado, número de páginas, transações extraídas, período
   - Tabela completa das transações extraídas
   - Click em qualquer linha para **marcá-la como incorreta** (excluída da importação)
   - Botões: **Cancelar** (descarta tudo) ou **Confirmar** (importa as marcadas OK)
5. Após confirmação, dashboard normal aparece com as transações

**Limitações conhecidas:**
- PDFs **escaneados/imagem** não são suportados (sem OCR)
- Cobertura estimada: **50-70% dos extratos brasileiros textuais** (varia por layout)
- Descrições complexas em múltiplas linhas podem ser fragmentadas
- Contraparte via heurística (menor precisão que o OFX estruturado)
- **Sempre confira os valores no preview antes de importar**

### 🌓 Tema Claro / Escuro
- Alternância entre modo claro e escuro pelo botão no cabeçalho (ícone lua/sol)
- Preferência salva em `localStorage` e restaurada sem "flash" ao recarregar
- Respeita `prefers-color-scheme` do sistema **apenas na primeira visita** — depois disso a escolha do usuário prevalece sobre a preferência do sistema
- Cores adaptativas no gráfico (grades e labels)
- Cards de resumo, painéis e tabela todos com variantes escuras
- **Correção do modo claro** (Turn 6): a configuração `darkMode: 'class'` do Tailwind é definida em `window.tailwind.config` **antes** do carregamento do CDN (padrão correto do Play CDN). `setTheme` usa `classList.add/remove` explícito em vez de `toggle`, e o handler do botão tem `preventDefault()` + `stopPropagation()`. Isso corrige o bug em que o modo escuro funcionava mas não era possível voltar ao modo claro.

### 📐 Layout em Largura Total
- A página ocupa **toda a largura** disponível (não há mais `max-w-7xl`) para melhor visualização das colunas
- Colunas da tabela aproveitam telas ultrawide sem cortes horizontais
- Cabeçalho e todos os cards se adaptam automaticamente

### ☑️ Seleção de Transações Específicas
- Checkbox em cada linha (desktop) e em cada card (mobile) permite selecionar transações
- Checkbox no cabeçalho da tabela seleciona/desmarca todas as transações **da página atual**
- Estado indeterminado (traço) quando parte das transações da página está selecionada
- Ao selecionar transações:
  - Cards de resumo (Créditos, Débitos, Saldo, Ticket Médio) mostram totais **da seleção**
  - Rodapé da tabela mostra "Total da seleção (N):"
  - Exportações CSV e PDF exportam **apenas os itens selecionados**
- Botão "Limpar seleção" aparece no cabeçalho da tabela quando há itens selecionados
- Ao aplicar filtros, itens selecionados que ficam fora do escopo são automaticamente removidos da seleção

### 📊 Colunas Saldo Antes / Saldo Após
- Ao lado da coluna Valor, duas novas colunas mostram a evolução do saldo:
  - **Saldo Antes** — saldo da conta imediatamente antes desta transação
  - **Saldo Após** — saldo da conta imediatamente depois desta transação (fica em vermelho quando negativo)
- Calculado a partir do saldo final (`BALAMT` do OFX) percorrendo as transações em ordem cronológica
- Permite análise da evolução do saldo transação a transação, útil para identificar quando a conta ficou negativa

### 🗂️ Coluna TxId (antes: Documento)
- Renomeada de "Documento" para **TxId** (Transaction ID)
- Mostra o `FITID` do OFX — identificador único da transação atribuído pelo banco
- Também usado como identificador nos checkboxes de seleção

### 📦 Cards Colapsáveis
Os seguintes cards podem ser recolhidos/expandidos individualmente com botão no canto superior direito:
- **Informações da Conta**
- **Calculadora de Porcentagem**
- **Evolução Diária** (gráfico)
- **Contrapartes** (já existia)

Ideal para focar na tabela em telas menores ou ocultar temporariamente informações não relevantes.

### 🔄 Botão Novo Arquivo Reposicionado
- Movido de dentro do card "Informações da Conta" para o **cabeçalho** (ao lado do toggle de tema)
- Sempre visível quando há um arquivo carregado, sem depender de rolar/expandir cards
- Aparece apenas após um arquivo ser carregado (fica oculto na tela inicial)

### 📱 Responsividade Mobile
- Layout adaptativo para celulares, tablets e desktop (breakpoints `sm:`, `md:`, `lg:`)
- Em telas pequenas a tabela vira **cards** com data, tipo, descrição, contraparte e valor
- Cabeçalho, filtros e painéis todos com espaçamento otimizado para toque

### 👥 Painel de Contrapartes com Contagem de Estornos
Além da contagem por tipo (crédito/débito), o painel de Contrapartes agora mostra:
- **Em todos os modos**: badge amarelo com número de estornos por contraparte + valor total de estornos
- Ícone de "undo" (↺) ao lado do nome quando a contraparte tem estornos associados

### 🔁 Botão Exclusivo de Estorno (independente do filtro de débito)
- Botão dedicado **"Somente Estornos"** no cabeçalho do painel de Contrapartes
- Aparece automaticamente apenas quando o arquivo contém pelo menos um estorno; badge âmbar mostra a quantidade
- **Independente** do filtro de tipo (Créditos/Débitos): pode ser combinado com qualquer combinação de filtros
- Quando ativo, o painel de contrapartes mostra apenas quem participou de estornos, e a tabela filtra somente essas transações
- Estilo visual próprio (âmbar) para não confundir com o filtro de estorno do dropdown

### 🔄 Filtro de Estorno / Devolução
- Detecção automática por:
  - Tags OFX padrão: `<CORRECTFITID>`, `<CORRECTACTION>` (REPLACE/DELETE)
  - `TRNTYPE=REVERSAL` (extensão de alguns bancos)
  - Palavras-chave em português: ESTORNO, DEVOLUÇÃO, REEMBOLSO, CANCELAMENTO, CHARGEBACK, REVERSÃO, RESSARCIMENTO
- Filtro aparece automaticamente **apenas** quando o arquivo contém estornos
- Opções: **Todos** / **Somente estornos** / **Ocultar estornos**
- Badge amarelo na tabela indicando o motivo (Estorno, Devolução, etc.)

### 🧾 Colunas Detalhadas de Estorno
Na tabela principal, as transações de estorno agora expõem 3 colunas adicionais em destaque âmbar:
- **Motivo Estorno** — categoria detectada (Estorno, Devolução, Reembolso, Chargeback, Cancelamento, Reversão, Ressarcimento) + descrição da transação original quando disponível
- **Destinatário Estorno** — nome da pessoa/empresa a quem o débito original foi enviado (o beneficiário do valor sendo devolvido)
- **FITID Original** — identificador da transação original que está sendo revertida (`CORRECTFITID` do OFX)

**Resolução do destinatário em 3 níveis** (por ordem de prioridade):
1. **Regex sobre MEMO/NAME** — padrões brasileiros como `ESTORNO IFOOD PEDIDO ALMOÇO` → `IFOOD`, `DEVOLUÇÃO PIX MARIA SILVA` → `MARIA SILVA`
2. **Bloco `<PAYEE>`** — leitura estruturada quando o OFX inclui o beneficiário
3. **Lookup por `CORRECTFITID`** — post-processing que localiza a transação original pelo FITID e herda a contraparte dela

Nos cards mobile, os detalhes do estorno aparecem em um bloco colapsável dentro do próprio card.

### 👁️ Modal de Prévia para Exportação
Ao clicar em **CSV** ou **PDF**, um modal de pré-visualização é aberto antes do download:
- **Header colorido** com ícone (verde para CSV, vermelho para PDF) e nome do arquivo que será gerado
- **Grid de 4 cards** com metadados: total de transações, créditos, débitos e saldo do que será exportado
- **Prévia scrollável** das primeiras 50 linhas (com aviso de "+N linhas restantes" quando houver mais), respeitando filtros e seleção atual
- Linhas de estorno destacadas com fundo âmbar mesmo na prévia
- Fechamento por: botão X, botão Cancelar, clique no backdrop ou tecla **ESC**
- Só após clicar em **Baixar** o arquivo é efetivamente gerado — evita downloads acidentais

### 📄 Exportação em PDF Profissional
- Botão vermelho **PDF** ao lado do CSV
- Fluxo: clique → **modal de prévia** → confirmação → geração do PDF
- Relatório em paisagem A4 com layout profissional:
  - **Header colorido** com faixa gradiente indigo (24mm) + faixa de acento e título/subtítulo em branco
  - **Card de informações da conta** com grid de 8 campos: Banco, Agência, Conta, Período, Saldo, Moeda, Total no extrato e No relatório
  - **Card de filtros aplicados** (fundo azul-50) descrevendo cada filtro ativo no momento da exportação
  - **5 summary cards** com borda esquerda colorida: Transações, Créditos, Débitos, Saldo, Estornos
  - **Tabela com destaque âmbar** para linhas de estorno; fonte Courier em FITID e TxId para leitura de identificadores; valores em negrito e coloridos por tipo
  - **Header repetido** em todas as páginas de continuação
  - **Footer profissional** com linha separadora, marca do sistema e paginação (`Página X de Y`)
  - **Card de total** com fundo escuro no fim do relatório
  - **Legenda** explicando o realce âmbar das linhas de estorno
- Usa **jsPDF + autotable** (via CDN) — geração 100% no navegador
- Colunas incluídas: 11 no total (Data/Hora, Tipo, Descrição, Conta Destino/Origem, Motivo Estorno, Destinatário Estorno, FITID Original, TxId, Valor, Saldo Antes, Saldo Após)

### 📊 Painel de Estatísticas
- Total de transações
- Total de créditos (com contagem de entradas)
- Total de débitos (com contagem de saídas)
- Saldo do período (créditos - débitos)
- Ticket médio das transações

### 🔍 Filtros Personalizados
- **Por tipo**: Todas / Somente Créditos / Somente Débitos
- **Por período**: Data e **hora** inicial/final (precisão de minuto)
- **Por descrição — busca avançada combinada**:
  - Múltiplas palavras separadas por espaço → **todas** devem existir (AND)
  - `"frase entre aspas"` → busca a frase exata
  - `-palavra` → exclui resultados com essa palavra
  - Ignora acentuação e caixa
  - Ex.: `pix maria` · `"netflix assinatura"` · `pagamento -pix`
- **Por conta destino/origem**: Busca combinada por nome, banco, agência ou número da conta.
  Também pode ser selecionada clicando na lista/painel de contrapartes (com totais de crédito/débito por contraparte).
  **Sincronizada com o tipo de transação**: ao selecionar Créditos, o painel mostra apenas contrapartes que aparecem em créditos (e vice-versa); se a contraparte selecionada não existe no novo tipo, o filtro é limpo automaticamente.
- **Por valor**: Valor mínimo e máximo
- **Ordenação**: Data (crescente/decrescente), Valor (crescente/decrescente), Descrição (A-Z)

### 🧮 Calculadora de Porcentagem
Aparece acima da Evolução Diária. Suporta 4 operações:
- **% de**: X% de um valor (ex.: 10% de R$ 1.000,00 = R$ 100,00)
- **Acrescentar %**: valor + juros/aumento (ex.: R$ 1.000,00 + 10% = R$ 1.100,00)
- **Descontar %**: valor - desconto (ex.: R$ 1.000,00 - 10% = R$ 900,00)
- **Qual %**: quanto A representa de B (ex.: R$ 200,00 é 20% de R$ 1.000,00)

**Aceita valores no formato brasileiro completo**:
- `10.000,00` (com ponto de milhar e vírgula decimal)
- `R$ 10.000,00` (com símbolo de moeda)
- `10000,00` (sem ponto de milhar)
- `10000.00` (formato americano) — também é aceito automaticamente

O valor é formatado ao sair do campo (blur). Os filtros de **Valor Mínimo** e **Valor Máximo** aceitam o mesmo formato.

### 🌐 Detecção Automática de Encoding
O leitor detecta automaticamente o encoding declarado no cabeçalho OFX:
- **UTF-8** (Nubank, fintechs modernas)
- **windows-1252 / cp1252** (Itaú, Bradesco, Banco do Brasil, Santander)
- **ISO-8859-1 / Latin1** (bancos com padrão Unix)
- Detecção pelas linhas `ENCODING:` e `CHARSET:` (OFX 1.x) ou pelo `<?xml encoding="..."?>` (OFX 2.x)
- Fallback heurístico caso o cabeçalho esteja ausente

Isso resolve o problema de textos aparecerem corrompidos (ex.: "DÃ‰BITO" em vez de "DÉBITO").

### 📄 Paginação
- Seleção de 100, 500 ou 1000 transações por página
- Navegação: Primeira / Anterior / Próxima / Última
- Indicador de página atual e total de itens exibidos
- Totalizadores e estatísticas sempre refletem TODAS as transações filtradas, não apenas a página visível

### 📈 Visualizações
- Gráfico de barras diário (créditos vs débitos) usando Chart.js
- Tabela detalhada de transações com badges de tipo
- Card de informações da conta (banco, agência, conta, tipo, período, saldo)

### 💾 Exportação
- Exportação para CSV com BOM UTF-8 (abre corretamente no Excel)
- Separador ponto-e-vírgula (padrão brasileiro)
- Valores em formato brasileiro (vírgula decimal)

## Rotas Disponíveis

| Método | Rota                     | Descrição                                    |
|--------|--------------------------|----------------------------------------------|
| GET    | `/`                      | Página principal (SPA de análise de extratos)|
| GET    | `/static/app.js`         | JavaScript do frontend (parser + UI)         |
| GET    | `/static/style.css`      | Estilos customizados                         |
| GET    | `/exemplo.ofx`           | Arquivo OFX de exemplo para testes           |
| GET    | `/exemplo-extrato.pdf`   | Arquivo PDF de exemplo para testes           |

Não há endpoints de API — todo o processamento (OFX e PDF) ocorre client-side por questões de segurança.

## Arquitetura de Dados

### Modelo de Transação
```typescript
{
  id: string,          // FITID do OFX
  date: Date,          // DTPOSTED (com hora quando disponível)
  type: 'credit'|'debit', // baseado no sinal do TRNAMT
  trnType: string,     // TRNTYPE (CREDIT, DEBIT, PIX, XFER, etc)
  description: string, // MEMO + NAME
  memo: string,        // MEMO original
  name: string,        // NAME original
  document: string,    // CHECKNUM ou REFNUM
  amount: number,      // valor com sinal
  absAmount: number,   // valor absoluto
  // Contraparte (destino em débitos, origem em créditos)
  counterparty: string,        // rótulo consolidado ex: "JOÃO SILVA · Bco 260 Ag 0001 Cc 44556-7"
  counterpartyName: string,    // apenas o nome
  counterpartyAccount: string, // número da conta (ACCTID de <BANKACCTTO>)
  counterpartyBank: string,    // BANKID
  counterpartyBranch: string,  // BRANCHID
  // Campos de estorno (preenchidos quando isReversal === true)
  isReversal: boolean,             // true se é estorno/devolução
  reversalReason: string,          // "Estorno", "Devolução", "Chargeback", etc.
  correctFitId: string,            // FITID da transação original (CORRECTFITID do OFX)
  correctAction: string,           // REPLACE ou DELETE (CORRECTACTION do OFX)
  reversalRecipient: string,       // nome do destinatário do débito original
  reversalOriginalDate: Date,      // data da transação original (resolvido via lookup)
  reversalOriginalAmount: number,  // valor da transação original
  reversalOriginalDescription: string, // descrição da transação original
  // Evolução de saldo
  balanceBefore: number,       // saldo antes desta transação
  balanceAfter: number         // saldo depois desta transação
}
```

**Fontes de extração da contraparte** (por ordem de prioridade):
1. Bloco estruturado `<BANKACCTTO>` / `<CCACCTTO>` do padrão OFX
2. Bloco `<PAYEE>` ou tag `<PAYEEID>` (beneficiário)
3. Heurística sobre `MEMO`/`NAME` — captura padrões brasileiros como "AG 1234 CC 56789-0", "BCO 260", "PIX ENVIADO NOME DA PESSOA"

### Modelo de Conta
```typescript
{
  bankId: string,      // BANKID
  branchId: string,    // BRANCHID
  accountId: string,   // ACCTID
  accountType: string, // CHECKING, SAVINGS, etc
  currency: string,    // CURDEF (padrão BRL)
  startDate: Date,     // DTSTART
  endDate: Date,       // DTEND
  balance: number,     // BALAMT
  balanceDate: Date    // DTASOF
}
```

### Armazenamento
- **Sem persistência**: os dados existem apenas na memória do navegador durante a sessão
- Ao recarregar a página, o usuário precisa fazer upload novamente
- **Motivo**: privacidade — dados bancários sensíveis nunca saem da máquina do usuário

## Guia de Uso

1. **Baixe o extrato OFX** do seu banco (opção geralmente disponível no internet banking, seção "Extrato" → "Baixar em OFX" ou "Financial Exchange")
2. **Acesse a aplicação** e arraste o arquivo `.ofx` para a área de upload (ou clique para selecionar)
3. **Explore o painel** com estatísticas automáticas do período
4. **Aplique filtros** conforme sua necessidade:
   - Ex: "Quanto gastei em PIX este mês?" → tipo: Débitos, buscar: "PIX"
   - Ex: "Quais os maiores gastos?" → ordenar por Valor decrescente
5. **Exporte em CSV** para análises adicionais no Excel

## Recursos Ainda Não Implementados

- 🔲 OCR para PDFs escaneados/imagem (Tesseract.js)
- 🔲 Categorização automática de transações (mercado, transporte, lazer, etc.)
- 🔲 Comparação entre múltiplos extratos (mês vs mês)
- 🔲 Detecção de transações recorrentes (assinaturas, contas fixas)
- 🔲 Persistência opcional (IndexedDB) para o usuário não precisar reenviar o arquivo
- 🔲 Suporte a arquivos CSV/TXT/CNAB de outros formatos
- 🔲 Detecção e alertas de gastos incomuns
- 🔲 Exportação em outros formatos (Excel .xlsx, JSON)
- 🔲 Templates específicos por banco no parser PDF (aumentar cobertura)

## Próximos Passos Recomendados

1. **Categorização inteligente**: implementar regras (regex) para classificar transações automaticamente por palavras-chave (Uber → Transporte, iFood → Alimentação, etc.)
2. **Múltiplos arquivos**: permitir carregar vários extratos e consolidar em uma visão única
3. **Persistência local**: usar IndexedDB para salvar histórico de extratos analisados
4. **Deploy em produção**: publicar no Cloudflare Pages
5. **Testes automatizados**: adicionar testes unitários para o parser OFX

## Deploy
- **Plataforma**: Cloudflare Pages
- **Status**: 🚧 Rodando em sandbox de desenvolvimento
- **Stack**: Hono + TypeScript + Vite + TailwindCSS + Chart.js + pdf.js
- **Última atualização**: 2026-08-09 (Turn 8 — suporte a leitura de extratos PDF com parser genérico + preview modal obrigatório antes da importação)

## Comandos Úteis

```bash
# Build de produção
npm run build

# Iniciar servidor local via PM2
pm2 start ecosystem.config.cjs

# Ver logs
pm2 logs webapp --nostream

# Parar servidor
pm2 delete webapp
```
