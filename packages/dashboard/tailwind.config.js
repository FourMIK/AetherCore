/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./index.html",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        carbon: '#0A0B0E',
        tungsten: '#E1E2E6',
        overmatch: '#00D4FF',
        jamming: '#FF2A2A',
        ghost: '#FFAE00',
        'verified-green': '#39FF14',
      },
      fontFamily: {
        display: ['Rajdhani', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      backdropBlur: {
        'glass-low': '8px',
        'glass-med': '12px',
        'glass-high': '16px',
      },
      borderRadius: {
        'chamfer': '0 20px 0 0',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInDown: {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInUp: {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseFast: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.3s ease-in',
        slideInDown: 'slideInDown 0.3s ease-out',
        slideInUp: 'slideInUp 0.3s ease-out',
        'pulse-fast': 'pulseFast 1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
