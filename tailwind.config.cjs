module.exports = {
  content: [
    './index.html',
    './src/**/*.html',
    './{about,admin,bookings,cancellation-policy,console,contact,design-system,destinations,excursions,hotels,journal,notifications,owner,partner,privacy,profile,refund-policy,restaurants,settings,terms,tools,transfers}/**/*.html',
    './*.js',
    './{admin,console}/**/*.js'
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'sans-serif'], display: ['Playfair Display', 'serif'] },
      colors: {
        ink: { 950: '#000000', 900: '#050505', 800: '#1a1a1a', 700: '#262626', 600: '#333333' },
        violet: { 50: '#fff7ed', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c' },
        gold: { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
        mist: { 50: '#f8f7fc', 100: '#f1eef9', 200: '#e8e3f4' }
      }
    }
  }
};
