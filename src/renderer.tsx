import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Leitor de Extrato Bancário OFX</title>
        {/* Favicon inline (SVG) — evita 404 no console */}
        <link
          rel="icon"
          type="image/svg+xml"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%232563eb'/%3E%3Ctext x='50' y='68' font-family='Arial,sans-serif' font-size='58' font-weight='700' text-anchor='middle' fill='white'%3E%24%3C/text%3E%3C/svg%3E"
        />
        {/*
          1) Configura Tailwind Play CDN ANTES de carregá-lo.
             O CDN lê window.tailwind.config na inicialização.
             Também aplica classe .dark no <html> ANTES do render (anti-flash).
             CRÍTICO: config precisa vir ANTES da anti-flash porque o CDN
             pode fazer scanning inicial imediatamente após carregar.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.tailwind = { config: { darkMode: 'class' } };
              // App é dark-only: fixa a classe .dark no <html> e no localStorage
              // para eliminar qualquer flash claro em qualquer navegador.
              (function() {
                try {
                  document.documentElement.classList.add('dark');
                  localStorage.setItem('theme', 'dark');
                } catch(e) {}
              })();
            `,
          }}
        ></script>
        <script src="https://cdn.tailwindcss.com"></script>
        <link
          href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
          rel="stylesheet"
        />
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        {/* Flatpickr — datepicker maior e customizável usado nos filtros de
            Data/Hora Inicial e Final. Locale pt-BR para nomes de meses/dias. */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/themes/dark.css" />
        <script src="https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/pt.js"></script>
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body class="bg-slate-950 min-h-screen">{children}</body>
    </html>
  )
})
