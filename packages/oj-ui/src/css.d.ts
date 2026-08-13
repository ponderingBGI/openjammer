// Co-located component stylesheets are imported for their side effect (the
// bundler injects them). This ambient declaration lets the package typecheck
// standalone (`tsc --noEmit`) without the app's `vite/client` types.
declare module '*.css';
