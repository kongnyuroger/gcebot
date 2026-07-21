// Sequential blue ramp from the dataviz skill's validated reference palette
// (references/palette.md) - single-hue, magnitude-only encoding for the line
// chart, bar chart, and ordinal funnel below. No dark-mode variant: this app
// has no theme toggle wired up anywhere yet (the shadcn .dark class is never
// applied), so a light/dark chart palette would be dead code today.
export const CHART_BLUE = '#2a78d6'; // step 450 - line/bar mark color
export const CHART_BLUE_FILL = 'rgba(42, 120, 214, 0.1)'; // ~10% wash for area fills

// Ordinal ramp for the 3-stage conversion funnel (registered -> activated ->
// paying) - each stage one step further along the same blue ramp, per
// palette.md's "ordinal ramp" guidance (lightest step still clears 2:1).
export const FUNNEL_STEPS = ['#86b6ef', '#2a78d6', '#184f95']; // steps 250 / 450 / 600
