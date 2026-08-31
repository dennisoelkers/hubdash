import styled from 'styled-components';
import { appVersion } from '../version';
import { tokens } from './theme';

const Wrapper = styled.footer`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: ${tokens.space(2)} ${tokens.space(5)};
  border-top: 1px solid ${tokens.color.border};
  background: ${tokens.color.background};
  font-size: 11px;
  font-family: ${tokens.font.mono};
  color: ${tokens.color.textMuted};
`;

export function Footer() {
  return <Wrapper>{`v${appVersion}`}</Wrapper>;
}
