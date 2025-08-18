/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      borderRadius: {
        xl: '12px',
      },
    },
  },
  plugins: [],
};

