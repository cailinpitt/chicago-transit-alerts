/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        gh: {
          canvas: '#0d1117', // main background
          surface: '#161b22', // card / panel background
          subtle: '#21262d', // button / interactive bg
          border: '#30363d', // borders
          muted: '#8b949e', // muted text
        },
      },
    },
  },
  plugins: [],
};
