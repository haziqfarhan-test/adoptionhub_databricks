/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"SF Pro Text"',
          '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif',
        ],
      },
      colors: {
        // Brand → Apple Blue (CSS-variable backed, supports opacity modifiers)
        brand: {
          50:  'rgb(var(--brand-50)  / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
        },
        // Dark scale → adapts (inverted) between light and dark via CSS vars
        dark: {
          50:  'rgb(var(--dark-50)  / <alpha-value>)',
          100: 'rgb(var(--dark-100) / <alpha-value>)',
          200: 'rgb(var(--dark-200) / <alpha-value>)',
          300: 'rgb(var(--dark-300) / <alpha-value>)',
          400: 'rgb(var(--dark-400) / <alpha-value>)',
          500: 'rgb(var(--dark-500) / <alpha-value>)',
          600: 'rgb(var(--dark-600) / <alpha-value>)',
          700: 'rgb(var(--dark-700) / <alpha-value>)',
          800: 'rgb(var(--dark-800) / <alpha-value>)',
          900: 'rgb(var(--dark-900) / <alpha-value>)',
          950: 'rgb(var(--dark-950) / <alpha-value>)',
        },
        // ui = black in light mode, white in dark mode — for opacity-based borders & hovers
        ui: 'rgb(var(--ui) / <alpha-value>)',
      },

      boxShadow: {
        'apple-sm': '0 1px 4px rgba(0,0,0,0.06)',
        'apple':    '0 2px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04)',
        'apple-md': '0 4px 24px rgba(0,0,0,0.09), 0 2px 8px rgba(0,0,0,0.05)',
        'apple-lg': '0 8px 40px rgba(0,0,0,0.11), 0 2px 8px rgba(0,0,0,0.06)',
        'apple-dk': '0 4px 20px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.35)',
        'apple-blue':    '0 4px 16px rgba(0,113,227,0.32)',
        'apple-blue-lg': '0 8px 30px rgba(0,113,227,0.42)',
        'inset-border': 'inset 0 0 0 1px rgba(0,0,0,0.08)',
      },

      transitionTimingFunction: {
        'apple':        'cubic-bezier(0.25, 1, 0.5, 1)',
        'apple-smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },

      animation: {
        'fade-in':    'fadeIn 0.4s cubic-bezier(0.25, 1, 0.5, 1)',
        'slide-up':   'slideUp 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
        'slide-in':   'slideIn 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
        'scale-in':   'scaleIn 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' },                                    to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(16px)' },     to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { from: { opacity: '0', transform: 'translateX(-12px)' },    to: { opacity: '1', transform: 'translateX(0)' } },
        scaleIn: { from: { opacity: '0', transform: 'scale(0.96)' },          to: { opacity: '1', transform: 'scale(1)' } },
      },

      backdropBlur: {
        apple: '20px',
        'apple-xl': '40px',
      },

      letterSpacing: {
        tightest: '-0.03em',
      },
    },
  },
  plugins: [],
}
