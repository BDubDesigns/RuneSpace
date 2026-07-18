// Ambient module declarations for non-code imports.
// Next.js types CSS modules (`*.module.css`) itself. Global stylesheets are
// imported for their side effects (e.g. `app/globals.css` in the root layout);
// TypeScript 7+ requires an explicit declaration for side-effect imports of
// non-TypeScript files, so we declare the plain `*.css` glob here.
declare module "*.css";
