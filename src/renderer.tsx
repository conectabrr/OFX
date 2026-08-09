import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Leitor de Extrato Bancário OFX</title>
        {/*
          1) Anti-flash: aplica classe .dark no <html> ANTES do render.
             Uso add/remove explícitos para garantir estado correto em ambas as direções.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var saved = localStorage.getItem('theme');
                  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var isDark = saved === 'dark' || (!saved && prefersDark);
                  var root = document.documentElement;
                  if (isDark) root.classList.add('dark');
                  else root.classList.remove('dark');
                } catch(e) {}
              })();
            `,
          }}
        ></script>
        {/*
          2) Configura Tailwind Play CDN ANTES de carregá-lo.
             O CDN lê window.tailwind.config na inicialização, então definir aqui
             garante que darkMode:'class' seja aplicado.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.tailwind = { config: { darkMode: 'class' } };
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
