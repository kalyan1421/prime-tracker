import { heroui } from "@heroui/react";

/**
 * HeroUI theme overrides.
 *
 * HeroUI's stock palette is a shade or two lighter than this app needs. Its flat Chips
 * already use the -700 step, but ITS -700 is lighter than Tailwind's, so status chips
 * landed under AA on the tinted grounds they sit on. Every value below was measured in
 * the running app against the real composited background, not picked by eye:
 *
 *   token                stock          measured   overridden to     measured
 *   ------------------------------------------------------------------------------
 *   warning-700          #93631 6       4.20:1     amber-800 #92400e   5.72:1
 *   danger-600           (pink)         4.08:1     rose-800  #9f1239   5.40:1
 *   success-700          (light green)  4.48:1     emerald-800 #065f46 6.26:1
 *   default-500          zinc-500       4.40:1     zinc-600  #52525b   passes
 *   foreground-500       zinc-500       4.40:1     zinc-600  #52525b   passes
 *   primary / focus      #006fee        4.46:1     blue-600  #155dfc   5.02:1
 *
 * `primary` does double duty. #006fee was a SECOND brand blue sitting beside the
 * Tailwind blue-600 the app uses everywhere else, so aligning it both clears the
 * contrast and collapses two blues into one. White-on-primary stays fine at 5.25:1,
 * so solid buttons are unaffected.
 *
 * Only the steps that failed are listed. Everything else inherits HeroUI's defaults —
 * secondary-600 already measured 6.79:1 and default-700 8.74:1, and restating passing
 * values here would just be more to keep in sync.
 *
 * See the design-system header in index.css for the app-side rules these mirror.
 */
export default heroui({
  themes: {
    light: {
      colors: {
        default: { 500: "#52525b" },
        foreground: { 500: "#52525b" },
        primary: { DEFAULT: "#155dfc", 500: "#155dfc" },
        success: { 700: "#065f46" },
        warning: { 700: "#92400e" },
        danger: { 600: "#9f1239", 700: "#881337" },
        focus: "#155dfc",
      },
    },
  },
});
