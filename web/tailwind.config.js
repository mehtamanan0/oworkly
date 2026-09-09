/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Legacy MVP level colors — untouched, still used by the old demo pages.
        l1: "#E53935",
        l2: "#1A237E",
        l3: "#2E7D32",
        l4: "#1565C0",
        // OWorkly design system (figma_reference_pack/README.md "Shared visual
        // system") — namespaced "fig-" so it never collides with the legacy
        // tokens above, per the two frontends staying independently runnable.
        "fig-navy": "#0A1F5A",
        "fig-blue": "#2563FF",
        "fig-orange": "#F47A20",
        "fig-green": "#16A34A",
        "fig-purple": "#7C3AED",
        "fig-red": "#DC2626",
        "fig-bg": "#F6F8FC",
        "fig-text": "#111827",
        "fig-muted": "#6B7280",
        "fig-border": "#E5E7EB",
      },
      borderRadius: {
        "fig-card": "12px",
      },
      boxShadow: {
        "fig-card": "0 1px 2px 0 rgba(16, 24, 40, 0.05)",
      },
    },
  },
  plugins: [],
};
