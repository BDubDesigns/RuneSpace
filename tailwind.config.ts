import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./features/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "var(--rs-surface-page)",
        panel: "var(--rs-surface-panel)",
        primary: "var(--rs-text-primary)",
        muted: "var(--rs-text-muted)",
        accent: "var(--rs-accent-primary)",
      },
      fontFamily: {
        display: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
