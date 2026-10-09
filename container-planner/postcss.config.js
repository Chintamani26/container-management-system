// Tailwind v4 is wired in via the @tailwindcss/vite plugin (see vite.config.ts), not PostCSS.
// This file exists only so an empty postcss.config.js doesn't make postcss-load-config fail
// (an empty module has no valid config export) and break every CSS import in the app.
export default {
  plugins: {},
};
