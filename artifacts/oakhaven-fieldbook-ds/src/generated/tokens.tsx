/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#f1eee6",
      "foreground": "#2e433a",
      "border": "#d7d0c1",
      "card": "#faf7ef",
      "cardForeground": "#2e433a",
      "popover": "#faf7ef",
      "popoverForeground": "#2e433a",
      "primary": "#315f50",
      "primaryForeground": "#f8f2e6",
      "secondary": "#ebe6d9",
      "secondaryForeground": "#52695d",
      "muted": "#f0ebdf",
      "mutedForeground": "#71857a",
      "accent": "#ba674d",
      "accentForeground": "#fff7e9",
      "destructive": "#a94f3f",
      "destructiveForeground": "#fff7e9",
      "input": "#d6cfbf",
      "ring": "#315f50",
      "chart1": "#ba674d",
      "chart2": "#4e7b68",
      "chart3": "#9a7847",
      "chart4": "#64867d",
      "chart5": "#d89b78",
      "sidebar": "#ebe6d9",
      "sidebarForeground": "#52695d",
      "sidebarBorder": "#d7d0c1",
      "sidebarPrimary": "#315f50",
      "sidebarPrimaryForeground": "#f8f2e6",
      "sidebarAccent": "#e1eadd",
      "sidebarAccentForeground": "#315f50",
      "sidebarRing": "#315f50"
    },
    "dark": {
      "background": "#0a0a0a",
      "foreground": "#fafafa",
      "border": "#262626",
      "card": "#0a0a0a",
      "cardForeground": "#fafafa",
      "popover": "#0a0a0a",
      "popoverForeground": "#fafafa",
      "primary": "#fafafa",
      "primaryForeground": "#171717",
      "secondary": "#262626",
      "secondaryForeground": "#fafafa",
      "muted": "#262626",
      "mutedForeground": "#a3a3a3",
      "accent": "#262626",
      "accentForeground": "#fafafa",
      "destructive": "#7f1d1d",
      "destructiveForeground": "#fafafa",
      "input": "#262626",
      "ring": "#d4d4d4",
      "chart1": "#3b6fe0",
      "chart2": "#2bbf9c",
      "chart3": "#f08c3c",
      "chart4": "#a855d6",
      "chart5": "#e0497a",
      "sidebar": "#171717",
      "sidebarForeground": "#f5f5f5",
      "sidebarBorder": "#262626",
      "sidebarPrimary": "#3b6fe0",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#262626",
      "sidebarAccentForeground": "#f5f5f5",
      "sidebarRing": "#d4d4d4"
    }
  },
  "fontFamily": {
    "sans": [
      "Inter",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "Menlo",
      "monospace"
    ]
  },
  "radius": "0.5rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
