/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fdf8ed',
          100: '#f9ecc9',
          200: '#f3d98e',
          300: '#edc658',
          400: '#e3b341',
          500: '#d4a017',
          600: '#bd8a10',
          700: '#9c6f12',
          800: '#7e5816',
          900: '#6a4916',
          950: '#3d2809',
        },
        surface: {
          900: '#0d1117',
          800: '#161b22',
          700: '#1c2333',
          600: '#21262d',
          500: '#30363d',
          400: '#484f58',
        },
        success: '#2ea043',
        danger:  '#f85149',
        warning: '#d29922',
        info:    '#388bfd',
      },
      fontFamily: {
        arabic: ['Tajawal', 'Cairo', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      }
    },
  },
  plugins: [],
}
