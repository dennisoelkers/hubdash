import type { BadgeTone } from '../types';

export const tokens = {
  color: {
    background: '#0d1117',
    surface: '#161b22',
    surfaceRaised: '#1c2230',
    border: '#30363d',
    text: '#e6edf3',
    textMuted: '#8b949e',
    accent: '#58a6ff',
    good: '#3fb950',
    bad: '#f85149',
    warn: '#d29922',
    neutral: '#8b949e',
  },
  space: (steps: number) => `${steps * 4}px`,
  radius: '6px',
  font: {
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
  },
} as const;

export function toneColor(tone: BadgeTone): string {
  switch (tone) {
    case 'good':
      return tokens.color.good;
    case 'bad':
      return tokens.color.bad;
    case 'warn':
      return tokens.color.warn;
    case 'neutral':
      return tokens.color.neutral;
  }
}
