# Design System: The Obsidian Intelligence Framework

## 1. Overview & Creative North Star
**The Creative North Star: "The Digital Synapse"**
This design system moves away from the static, "boxed-in" feel of traditional utility apps to create a high-end, editorial experience that feels like a seamless extension of the user’s own mind. We are building a "Digital Synapse"—a space that is moody, deep, and hyper-organized, echoing the sophisticated environment of a modern developer’s IDE but softened for a premium consumer experience.

By leaning into **Tonal Layering** and **Intentional Asymmetry**, we break the "template" look. Layouts should prioritize breathing room and content hierarchy over structural containers. The goal is to make the user feel like they are interacting with a living, breathing archive rather than a flat database.

---

## 2. Colors & Surface Philosophy
The palette is rooted in deep charcoal and slate, designed to reduce cognitive load and provide a high-contrast stage for "electric" primary actions.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to define sections or cards. Structure must be achieved exclusively through:
1.  **Background Color Shifts:** Using `surface-container-low` (#191b22) against the main `surface` (#111319).
2.  **Negative Space:** Utilizing the `Spacing Scale` (e.g., `8` or `10`) to separate conceptual blocks.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the `surface-container` tiers to create "nested" depth:
*   **Base Layer:** `surface` (#111319) - The primary canvas.
*   **Recessed Content:** `surface-container-lowest` (#0c0e14) - For secondary search bars or input areas.
*   **Primary Containers:** `surface-container-low` (#191b22) - For the main feed or chat bubbles.
*   **Elevated Details:** `surface-container-high` (#282a30) - For active decision cards or overlays.

### The "Glass & Gradient" Rule
To elevate beyond a standard dark theme, use Glassmorphism for floating elements (like the bottom navigation or compact headers). Apply `surface-variant` (#33343b) at 60% opacity with a `20px` backdrop-blur. 
*   **Signature Texture:** Main CTAs should not be flat. Apply a subtle linear gradient from `primary` (#adc6ff) to `primary-container` (#4d8eff) at a 135-degree angle to give the button "soul" and a slight inner glow.

---

## 3. Typography: Editorial Precision
The system pairs the technical rigidity of `Inter` with the high-impact, geometric personality of `Space Grotesk`.

*   **Display & Headlines (`Space Grotesk`):** Used for "Big Ideas"—memory summaries, dates, or AI-generated insights. The large scale (`display-sm` to `headline-lg`) provides an authoritative, editorial feel.
*   **Body & Labels (`Inter`):** Optimized for long-form reading of memories and chat logs. Use `body-md` for general text and `label-sm` for metadata (timestamps, category tags).
*   **Hierarchy Note:** Always pair a `headline-sm` in `on-surface` (#e2e2eb) with a `label-md` in `on-surface-variant` (#c2c6d6) to create a clear, professional contrast between "Title" and "Context."

---

## 4. Elevation & Depth: Tonal Layering
Traditional shadows are too heavy for a "Moody IDE" aesthetic. We use light and tone to imply height.

*   **The Layering Principle:** Instead of a shadow, place a `surface-container-low` card on top of a `surface` background. The slight shift from #111319 to #191b22 provides a sophisticated, "flat-depth" look.
*   **Ambient Shadows:** For floating Modals only, use a large, diffused shadow: `0px 20px 40px rgba(0, 0, 0, 0.4)`. The shadow color is not black, but a deeply desaturated version of the background.
*   **The "Ghost Border":** If accessibility requires a stroke (e.g., in high-sunlight environments), use `outline-variant` (#424754) at **15% opacity**. It should be felt, not seen.

---

## 5. Components

### Cards & Decision Elements
*   **Rule:** No dividers. Use a `1.4rem` (`spacing.4`) vertical gap between items.
*   **Decision Cards:** Use `surface-container-high`. Status indicators (Green/Yellow/Red/Purple) should be styled as 4px wide vertical "pills" on the far left edge of the card, rather than large icons, to maintain professional minimalism.

### Chat Bubbles
*   **AI Response:** `surface-container-low` with a subtle `primary` glow (2px inner shadow).
*   **User Input:** `surface-container-highest` with `8px` (`DEFAULT`) rounded corners.

### Interactive Elements
*   **Primary Action Button:** Gradient-filled (`primary` to `primary-container`), `8px` rounded corners, `1.2rem` horizontal padding.
*   **Chips:** Use `surface-container-high` for unselected and `primary` for selected. Avoid borders; use color weight to signify state.
*   **Input Fields:** `surface-container-lowest`. On focus, change the background to `surface-container-low` and add a `primary` ghost-border (20% opacity).

### Specialized Components
*   **The Synapse Header:** A compact, fixed top-bar using Glassmorphism. The title uses `title-sm` in `Space Grotesk`.
*   **Memory Badges:** Tiny, high-contrast dots using `tertiary` (#ffb786) to indicate "Unread AI Insights."

---

## 6. Do’s and Don’ts

### Do
*   **Do** use asymmetrical spacing. A card might have `1.4rem` top padding and `1.7rem` bottom padding to create a sense of movement.
*   **Do** use `on-surface-variant` (#c2c6d6) for all secondary text to maintain the "moody" atmosphere.
*   **Do** utilize `backdrop-filter: blur(12px)` on all overlay surfaces to keep the user grounded in their current context.

### Don’t
*   **Don’t** use pure white (#FFFFFF). It breaks the dark-mode immersion. Always stick to `on-surface` (#e2e2eb).
*   **Don’t** use standard 1px dividers. If you feel the need for a line, your spacing or background tonal shifts are not strong enough.
*   **Don’t** use sharp 0px corners. This is an assistant app; it should feel technical (IDE-like) but approachable. Stick strictly to the `8px` (`DEFAULT`) and `12px` (`md`) radius tokens.
*   **Don’t** clutter the compact header. It should contain a maximum of three elements: Brand/Page Title, Memory Icon, and Search.