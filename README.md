# Leitor de Extrato Bancário OFX

## Visão Geral
- **Nome**: Leitor de Extrato OFX
- **Objetivo**: Sistema web para leitura e análise de extratos bancários em formato OFX (Open Financial Exchange), padrão usado por bancos brasileiros
- **Diferencial**: Processamento 100% local no navegador — nenhum dado bancário é enviado para servidores

> **Nota sobre o formato**: A solicitação original mencionava "pfx", porém PFX é formato de certificado digital. O formato correto para extratos bancários é **OFX** (Open Financial Exchange), que é o adotado pela maioria dos bancos brasileiros para exportação de extratos.

## URLs
- **Sandbox (desenvolvimento)**: https://3000-ieuqgzbrndccyipebk6dr-b237eb32.sandbox.novita.ai
- **Arquivo OFX de exemplo**: `/exemplo.ofx` (download disponível para teste)
- **Produção**: (não deployado ainda)

## Funcionalidades Implementadas

### 📤 Upload
- Upload por drag-and-drop ou seleção manual
- Detecção automática de encoding ISO-8859-1 (padrão dos bancos brasileiros)
- Suporte a OFX SGML (v1.x) e XML (v2.x)

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
- **Por valor**: Valor mínimo e máximo
- **Ordenação**: Data (crescente/decrescente), Valor (crescente/decrescente), Descrição (A-Z)

### 🧮 Calculadora de Porcentagem
Aparece acima da Evolução Diária. Suporta 4 operações:
- **% de**: X% de um valor (ex.: 10% de R$ 1.000,00 = R$ 100,00)
- **Acrescentar %**: valor + juros/aumento (ex.: R$ 1.000,00 + 10% = R$ 1.100,00)
- **Descontar %**: valor - desconto (ex.: R$ 1.000,00 - 10% = R$ 900,00)
- **Qual %**: quanto A representa de B (ex.: R$ 200,00 é 20% de R$ 1.000,00)

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

| Método | Rota                | Descrição                                    |
|--------|---------------------|----------------------------------------------|
| GET    | `/`                 | Página principal (SPA de análise de extratos)|
| GET    | `/static/app.js`    | JavaScript do frontend (parser + UI)         |
| GET    | `/static/style.css` | Estilos customizados                         |
| GET    | `/exemplo.ofx`      | Arquivo OFX de exemplo para testes           |

Não há endpoints de API — todo o processamento OFX ocorre client-side por questões de segurança.

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
  counterpartyBranch: string   // BRANCHID
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

- 🔲 Categorização automática de transações (mercado, transporte, lazer, etc.)
- 🔲 Comparação entre múltiplos extratos (mês vs mês)
- 🔲 Detecção de transações recorrentes (assinaturas, contas fixas)
- 🔲 Persistência opcional (IndexedDB) para o usuário não precisar reenviar o arquivo
- 🔲 Suporte a arquivos CSV/TXT de outros formatos
- 🔲 Relatório imprimível em PDF
- 🔲 Modo escuro (dark mode)
- 🔲 Detecção e alertas de gastos incomuns

## Próximos Passos Recomendados

1. **Categorização inteligente**: implementar regras (regex) para classificar transações automaticamente por palavras-chave (Uber → Transporte, iFood → Alimentação, etc.)
2. **Múltiplos arquivos**: permitir carregar vários extratos e consolidar em uma visão única
3. **Persistência local**: usar IndexedDB para salvar histórico de extratos analisados
4. **Deploy em produção**: publicar no Cloudflare Pages
5. **Testes automatizados**: adicionar testes unitários para o parser OFX

## Deploy
- **Plataforma**: Cloudflare Pages
- **Status**: 🚧 Rodando em sandbox de desenvolvimento
- **Stack**: Hono + TypeScript + Vite + TailwindCSS + Chart.js
- **Última atualização**: 2026-08-09

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
