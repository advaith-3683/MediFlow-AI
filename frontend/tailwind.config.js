/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: { colors: { brand: { 50: "#edf4ff", 100: "#dbeafe", 600: "#2166c5", 700: "#1849a9", 800: "#123b89" }, ink: "#13213a" }, boxShadow: { brand: "0 4px 12px rgba(24,73,169,.2)" } },
  },
  plugins: [],
}
