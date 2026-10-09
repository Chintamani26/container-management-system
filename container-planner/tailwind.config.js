// Tailwind v4 scans source files automatically via the @tailwindcss/vite plugin, so this file
// is not required for the utility classes to work. It's kept so `content` and `theme.extend`
// have an obvious place to live if the project later needs explicit overrides.
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
