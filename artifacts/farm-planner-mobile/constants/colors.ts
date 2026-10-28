/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#22352F',
    tint: '#336E5C',

    // Core surfaces
    background: '#F3EFE4',
    foreground: '#22352F',

    // Cards / elevated surfaces
    card: '#FBF9F2',
    cardForeground: '#22352F',

    // Primary action color (buttons, links, active states)
    primary: '#336E5C',
    primaryForeground: '#FBF9F2',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#E5DCC2',
    secondaryForeground: '#22352F',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#E8E1CF',
    mutedForeground: '#64776E',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#F0B65F',
    accentForeground: '#22352F',

    // Destructive actions (delete, error states)
    destructive: '#C94836',
    destructiveForeground: '#FBF9F2',

    // Borders and input outlines
    border: '#D8D0BD',
    input: '#BFB49E',
  },

  dark: {
    text: '#F6F1E4',
    tint: '#A7C49B',
    background: '#1F2D28',
    foreground: '#F6F1E4',
    card: '#2A3A33',
    cardForeground: '#F6F1E4',
    primary: '#A7C49B',
    primaryForeground: '#173026',
    secondary: '#39483C',
    secondaryForeground: '#F6F1E4',
    muted: '#313E37',
    mutedForeground: '#B8C6B4',
    accent: '#E8B75F',
    accentForeground: '#1F2D28',
    destructive: '#E48770',
    destructiveForeground: '#1F2D28',
    border: '#4A5A50',
    input: '#697669',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 12,
};

export default colors;
