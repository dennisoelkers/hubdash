import { createGlobalStyle } from 'styled-components';
import { tokens } from './theme';

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: ${tokens.color.background};
    color: ${tokens.color.text};
    font-family: ${tokens.font.body};
  }
`;
