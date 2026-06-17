import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#164e63",
          accent: "#f97316"
        }
      },
      boxShadow: {
        card: "0 16px 40px rgba(15, 23, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
