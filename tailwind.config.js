/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        elevated: 'var(--bg-elevated)',
        glass: 'var(--glass-bg)',
        glassBorder: 'var(--glass-border)',
        hairline: 'var(--hairline)',
        content: 'var(--text)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        accent: 'var(--accent)',
        accentSoft: 'var(--accent-soft)',
        amber: 'var(--amber)',
        amberSoft: 'var(--amber-soft)',
        kind: {
          thought: 'var(--kind-thought)',
          action: 'var(--kind-action)',
          observation: 'var(--kind-observation)',
          error: 'var(--kind-error)',
          final: 'var(--kind-final)',
        },
      },
      borderRadius: {
        xl2: '20px',
        xl3: '28px',
      },
      backdropBlur: {
        xl: '20px',
        '2xl': '24px',
      },
      boxShadow: {
        glass: 'var(--shadow)',
        glassSm: 'var(--shadow-sm)',
        glow: '0 0 0 1px var(--accent-glow), 0 0 22px var(--accent-glow)',
      },
      keyframes: {
        fadeSlideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        pulseDot: {
          '0%, 80%, 100%': { opacity: '0.25', transform: 'scale(0.7)' },
          '40%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        breathGlow: {
          '0%, 100%': { boxShadow: '0 0 0 1px var(--accent-soft), 0 0 8px var(--accent-soft)' },
          '50%': { boxShadow: '0 0 0 1px var(--accent-glow), 0 0 24px var(--accent-glow)' },
        },
        spinSlow: {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-slide': 'fadeSlideUp 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-dot': 'pulseDot 1.2s ease-in-out infinite',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        breath: 'breathGlow 2.4s ease-in-out infinite',
        'spin-slow': 'spinSlow 2s linear infinite',
      },
    },
  },
  plugins: [],
};
