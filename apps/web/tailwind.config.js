/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#071433",
        board: "#0c2f86",
        gold: "#f6c445",
      },
      fontFamily: {
        display: ["Oswald", "Impact", "sans-serif"],
        sans: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
