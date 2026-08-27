import styled from 'styled-components';
import { tokens } from './theme';

export type TabId = 'board' | 'backports';

export type TabBarProps = {
  active: TabId;
  onChange: (tab: TabId) => void;
  boardCount: number;
  backportsCount: number;
};

const Bar = styled.div`
  display: flex;
  gap: ${tokens.space(4)};
  padding: 0 ${tokens.space(5)};
  border-bottom: 1px solid ${tokens.color.border};
`;

const Tab = styled.button`
  padding: ${tokens.space(2)} 0;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: ${tokens.color.textMuted};
  font-family: ${tokens.font.body};
  font-size: 13px;
  cursor: pointer;

  &[aria-selected='true'] {
    color: ${tokens.color.text};
    border-bottom-color: ${tokens.color.accent};
  }
`;

export function TabBar({ active, onChange, boardCount, backportsCount }: TabBarProps) {
  return (
    <Bar role="tablist">
      <Tab role="tab" aria-selected={active === 'board'} onClick={() => onChange('board')}>
        {`Board  ${boardCount}`}
      </Tab>
      <Tab role="tab" aria-selected={active === 'backports'} onClick={() => onChange('backports')}>
        {`Backports  ${backportsCount}`}
      </Tab>
    </Bar>
  );
}
