/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        // Background graduais (espelha design-spec §2)
        bg: {
          0: "#060708",
          1: "#0c0e11",
          2: "#14171c",
        },
        surface: {
          DEFAULT: "#1a1e25",
          hi: "#232830",
        },
        accent: {
          DEFAULT: "#5FE6FF",
          2: "#B8FFEE",
          deep: "#1A8FA8",
        },
        slot: {
          1: "#5FE6FF",
          2: "#7DD3FC",
          3: "#A5B4FC",
          local: "#FBBF24",
        },
        fg: {
          DEFAULT: "#E8ECEF",
          soft: "#B5BCC4",
        },
        muted: "#7C8590",
        faint: "#4A525C",
        border: {
          DEFAULT: "#1f242c",
          strong: "#2c333d",
        },
        success: "#34D399",
        warning: "#FBBF24",
        danger: "#F87171",
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono Variable", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        display: ["clamp(2.5rem, 5vw + 1rem, 4rem)", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
      },
      boxShadow: {
        glow: "0 0 24px rgba(95, 230, 255, 0.18)",
        glowStrong: "0 0 36px rgba(95, 230, 255, 0.32)",
        overlay: "0 8px 32px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(95, 230, 255, 0.08)",
      },
      backgroundImage: {
        "flow-gradient": "linear-gradient(120deg, #5FE6FF 0%, #B8FFEE 50%, #5FE6FF 100%)",
        "hero-radial":
          "radial-gradient(1200px 600px at 50% -10%, rgba(95, 230, 255, 0.10), transparent 60%), radial-gradient(800px 400px at 80% 20%, rgba(184, 255, 238, 0.05), transparent 60%)",
      },
      animation: {
        breathe: "breathe 2s ease-in-out infinite",
        "armed-pulse": "armedPulse 600ms ease-in-out infinite",
        wave: "wave 1.1s ease-in-out infinite",
        "fade-in-up": "fadeInUp 600ms ease-out both",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "0.7" },
        },
        armedPulse: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.85" },
          "50%": { transform: "scale(1.35)", opacity: "1" },
        },
        wave: {
          "0%, 100%": { height: "20%" },
          "50%": { height: "100%" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
