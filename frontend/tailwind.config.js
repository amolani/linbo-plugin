import edulutionConfig from '@edulution-io/ui-kit/tailwind.config';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [edulutionConfig],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@edulution-io/ui-kit/**/*.{js,cjs}",
  ],
  theme: {
    extend: {
      colors: {
        ciGreen: 'var(--ci-light-green)',
        ciBlue: 'var(--ci-dark-blue)',
        ciRed: '#dc2626',
        // LINBO-specific: card needs visible BG (not transparent)
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
}
