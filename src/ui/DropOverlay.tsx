import styled from 'styled-components';
import { tokens } from './theme';

export type DropOverlayProps = { visible: boolean };

const Overlay = styled.div`
  position: fixed;
  inset: ${tokens.space(3)};
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed ${tokens.color.accent};
  border-radius: ${tokens.radius};
  background: rgba(13, 17, 23, 0.85);
  color: ${tokens.color.accent};
  font-family: ${tokens.font.body};
  font-size: 18px;
  pointer-events: none;
  z-index: 30;
`;

export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) return null;
  return <Overlay data-testid="drop-overlay">Drop a pull request link to track it</Overlay>;
}
