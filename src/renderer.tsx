import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Leitor de Extrato Bancário OFX</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link
          href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
          rel="stylesheet"
        />
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body class="bg-slate-100 min-h-screen">{children}</body>
    </html>
  )
})
