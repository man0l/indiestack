/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,svelte}', './admin/src/**/*.{js,ts,svelte}'],
  // Preflight off: the Worker pages carry their own hand-rolled CSS and a
  // global reset would fight it. Islands get a minimal base in app.css.
  corePlugins: { preflight: false },
  theme: {
    extend: {},
  },
  plugins: [],
};
