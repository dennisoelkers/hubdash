import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { appVersion } from '../version';
import { Footer } from './Footer';

describe('Footer', () => {
  it('shows the app version', () => {
    render(<Footer />);
    expect(screen.getByText(`v${appVersion}`)).toBeInTheDocument();
  });
});
