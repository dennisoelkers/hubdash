import styled from 'styled-components';
import { appVersion } from '../version';
import { tokens } from './theme';

const Wrapper = styled.footer`
  padding: ${tokens.space(3)} ${tokens.space(5)};
  font-size: 11px;
  font-family: ${tokens.font.mono};
  color: ${tokens.color.textMuted};
`;

export function Footer() {
  return <Wrapper>{`v${appVersion}`}</Wrapper>;
}
