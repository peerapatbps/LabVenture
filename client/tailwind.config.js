/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#8CC0EB',  // focal sky-mid
          dark:    '#4A8CC8',  // focal dark — for white text on focal bg
          light:   '#BFDDF0',  // L3 data surface
        },
        earth: {
          DEFAULT: '#FFF9D2',  // L1 page field
          card:    '#FFEBCC',  // L2 panel surfaces
          border:  '#EED8B0',  // L1/L2 border
          ink:     '#3A2410',  // dark warm-brown
          ink2:    '#7A5830',  // medium warm-brown
          ink3:    '#B89060',  // light warm-brown
        },
      },
      keyframes: {
        fadeSlideUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fadeSlideUp': 'fadeSlideUp 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
