/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        l1: "#E53935",
        l2: "#1A237E",
        l3: "#2E7D32",
        l4: "#1565C0",
      },
    },
  },
  plugins: [],
};
