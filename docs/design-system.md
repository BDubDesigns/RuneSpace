# RuneSpace Design System

## Goals

The visual foundation is a mobile-first, readable low-fi sci-fi interface. It uses deep layered surfaces, cyan structural emphasis, and semantic accents without representing gameplay state.

## Tokens

`app/globals.css` owns the complete theme through `--rs-*` CSS custom properties. Tailwind exposes the core color roles for composition, but components consume token-backed classes rather than literal color values. Change a theme by changing those tokens; do not add feature-local color, shadow, bevel, control-size, or transition recipes.

## Primitives

`components/ui/` contains presentational primitives only: panels, headings, actions, form fields, feedback, status meters, and the responsive shell. Intent variants use `primary`, `secondary`, `success`, `mining`, `arcane`, and `danger`; use the semantic intent, never a visual hex value.

## Accessibility

Controls use a 44px practical minimum target and visible `:focus-visible` ring. Error feedback has an alert role, disabled controls retain labels, and reduced-motion users receive near-instant transitions. Color supplements, rather than replaces, text labels and states.

## Feature Styling

Pages and features compose primitives and may add layout-only classes. Feature code must not own visual recipes or game rules. Authentication and character ownership remain in `features/` and `server/`; this system contains no inventory, resource, map, quest, or progression logic.
