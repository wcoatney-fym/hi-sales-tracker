/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1a2744',
          dark: '#111827',
          light: '#1e3a5f',
          mid: '#243b61',
        },
        gold: {
          DEFAULT: '#d4a84b',
          light: '#e8c876',
          dark: '#b8892e',
          muted: '#a68a4b',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'shimmer': 'shimmer 2.5s ease-in-out infinite',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
        'flame-flicker': 'flameFlicker 0.4s ease-in-out infinite alternate',
        'slide-up': 'slideUp 0.4s ease-out',
        'count-up': 'countUp 0.6s ease-out',
        'spin-slow': 'spin 3s linear infinite',
        'bounce-in': 'bounceIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'gradient-shift': 'gradientShift 3s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2.5s ease-in-out infinite',
        'bar-fill': 'barFill 1s ease-out forwards',
        'sparkle': 'sparkle 1.5s ease-in-out infinite',
        'sweep': 'sweep 2s ease-in-out',
        'float': 'float 6s ease-in-out infinite',
        'slide-in-left': 'slideInLeft 0.5s ease-out',
        'pulse-border': 'pulseBorder 2s ease-in-out infinite',
        'shake': 'shake 0.5s ease-in-out',
        'crown-orbit': 'crownOrbit 3s linear infinite',
        'neon-flicker': 'neonFlicker 2s ease-in-out infinite',
        'level-up': 'levelUp 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'combo-pulse': 'comboPulse 0.8s ease-in-out infinite',
        'ribbon-wave': 'ribbonWave 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseGold: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(212, 168, 75, 0.4)' },
          '50%': { boxShadow: '0 0 0 8px rgba(212, 168, 75, 0)' },
        },
        flameFlicker: {
          '0%': { transform: 'scale(1) rotate(-2deg)' },
          '100%': { transform: 'scale(1.1) rotate(2deg)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        countUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        bounceIn: {
          '0%': { opacity: '0', transform: 'scale(0.3)' },
          '50%': { transform: 'scale(1.05)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        gradientShift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 15px 0 rgba(212, 168, 75, 0.3), inset 0 0 15px 0 rgba(212, 168, 75, 0.05)' },
          '50%': { boxShadow: '0 0 30px 5px rgba(212, 168, 75, 0.4), inset 0 0 20px 0 rgba(212, 168, 75, 0.1)' },
        },
        barFill: {
          '0%': { width: '0%' },
          '100%': { width: 'var(--bar-width)' },
        },
        sparkle: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(0.8)' },
          '50%': { opacity: '1', transform: 'scale(1.2)' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseBorder: {
          '0%, 100%': { borderColor: 'rgba(212, 168, 75, 0.3)' },
          '50%': { borderColor: 'rgba(212, 168, 75, 0.7)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-1px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(1px)' },
        },
        crownOrbit: {
          '0%': { transform: 'rotate(0deg) scale(1)' },
          '25%': { transform: 'rotate(5deg) scale(1.05)' },
          '50%': { transform: 'rotate(0deg) scale(1.1)' },
          '75%': { transform: 'rotate(-5deg) scale(1.05)' },
          '100%': { transform: 'rotate(0deg) scale(1)' },
        },
        neonFlicker: {
          '0%, 100%': { opacity: '1' },
          '92%': { opacity: '1' },
          '93%': { opacity: '0.8' },
          '94%': { opacity: '1' },
          '96%': { opacity: '0.9' },
          '97%': { opacity: '1' },
        },
        levelUp: {
          '0%': { transform: 'scale(1)', opacity: '0' },
          '50%': { transform: 'scale(1.3)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        comboPulse: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.08)' },
        },
        ribbonWave: {
          '0%, 100%': { transform: 'skewX(-2deg)' },
          '50%': { transform: 'skewX(2deg)' },
        },
        indeterminate: {
          '0%': { transform: 'translateX(-100%)', width: '40%' },
          '50%': { width: '60%' },
          '100%': { transform: 'translateX(250%)', width: '40%' },
        },
      },
    },
  },
  plugins: [],
};
