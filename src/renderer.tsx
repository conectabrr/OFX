import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Leitor de Extrato Bancário OFX</title>
        {/* Configuração do Tailwind para dark mode via classe (deve vir ANTES do CDN) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Restaura tema salvo antes do Tailwind carregar (evita flash)
              (function() {
                try {
                  var saved = localStorage.getItem('theme');
                  if (saved === 'dark' || (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
              window.tailwind = window.tailwind || {};
              window.tailwind.config = { darkMode: 'class' };
            `,
          }}
        ></script>
        <script src="https://cdn.tailwindcss.com"></script>
        <link
          href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
          rel="stylesheet"
        />
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body class="bg-slate-100 dark:bg-slate-950 min-h-screen transition-colors">{children}</body>
    </html>
  )
})
