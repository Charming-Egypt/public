// Tailwind build config (the site ships a pre-compiled /tailwind.css, no CDN at runtime).
// Regenerate after changing any class name in src/, *.js:
//   tailwindcss -c tools/tailwind.config.js -i tools/tailwind.input.css -o tailwind.css --minify && npm run build
module.exports = {
  content: ['./src/**/*.html', './shared/*.js', './design-system/*.html', './tools/build.mjs'],
  theme: { extend: {
    fontFamily: { sans: ['Inter', 'sans-serif'], display: ['Playfair Display', 'serif'] },
    colors: {
      ink: { 950: '#000000', 900: '#050505', 800: '#1a1a1a', 700: '#262626', 600: '#333333' },
      violet: { 50: '#fff7ed', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c' },
      gold: { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
      mist: { 50: '#f8f7fc', 100: '#f1eef9', 200: '#e8e3f4' },
    },
  } },
};
