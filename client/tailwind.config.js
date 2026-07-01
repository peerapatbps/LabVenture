/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0369a1', light: '#e0f2fe' },
      },
    },
  },
  plugins: [],
};
