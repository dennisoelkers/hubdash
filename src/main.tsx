import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root element is missing from index.html');
}

// Empty string when the app owns the domain root (`BASE_URL` is `/`); the
// subpath otherwise (e.g. `/hubdash` when built with `--base=/hubdash/` for
// a GitHub Pages project site) — wouter treats "" as no base at all.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(root).render(
  <StrictMode>
    <Router base={base}>
      <App />
    </Router>
  </StrictMode>,
);
