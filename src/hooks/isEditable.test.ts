import { describe, expect, it } from 'vitest';
import { isEditable } from './isEditable';

describe('isEditable', () => {
  it('is false for null', () => {
    expect(isEditable(null)).toBe(false);
  });

  it('is false for a non-element target', () => {
    expect(isEditable({} as EventTarget)).toBe(false);
  });

  it('is true for an input', () => {
    expect(isEditable(document.createElement('input'))).toBe(true);
  });

  it('is true for a textarea', () => {
    expect(isEditable(document.createElement('textarea'))).toBe(true);
  });

  it('is true for a contenteditable element', () => {
    // jsdom does not actually compute `isContentEditable` (it always reports
    // `undefined`), so the getter is stubbed directly to exercise this branch.
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isEditable(div)).toBe(true);
  });

  it('is false for a button or other plain element', () => {
    expect(isEditable(document.createElement('button'))).toBe(false);
    expect(isEditable(document.createElement('div'))).toBe(false);
  });
});
