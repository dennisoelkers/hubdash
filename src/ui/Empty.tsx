import styled from 'styled-components';
import { tokens } from './theme';

/** The centred prompt shown when a tab or the app has nothing to display. */
export const Empty = styled.div`
  padding: ${tokens.space(12)} ${tokens.space(5)};
  text-align: center;
  color: ${tokens.color.textMuted};
  font-family: ${tokens.font.body};
`;
