import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePr } from '../test/makePr';
import type { IssueEntry, NormalisedIssue, PrEntry, TrackedTask } from '../types';
import { TaskRow } from './TaskRow';

const prTask: TrackedTask = {
  kind: 'pr',
  owner: 'Example',
  repo: 'example-server',
  number: 4821,
  addedAt: '2026-08-27T09:00:00Z',
};

function issueOf(overrides: Partial<NormalisedIssue> = {}): NormalisedIssue {
  return {
    key: 'example/example-server#55',
    owner: 'Example',
    repo: 'example-server',
    number: 55,
    title: 'Sort order is wrong on empty input',
    url: 'https://github.com/Example/example-server/issues/55',
    author: 'octocat',
    nameWithOwner: 'Example/example-server',
    updatedAt: '2026-08-27T10:00:00Z',
    lifecycle: 'OPEN',
    ...overrides,
  };
}

const noop = () => {};

describe('TaskRow — pending and errored', () => {
  it('shows a pending placeholder when no entry has resolved yet', () => {
    render(
      <TaskRow
        task={prTask}
        entry={undefined}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    expect(screen.getByText('#4821')).toBeInTheDocument();
  });

  it('shows the transport error message for an errored entry', () => {
    const entry: PrEntry = {
      status: 'error',
      key: 'example/example-server#4821',
      tracked: prTask,
      message: 'This pull request could not be loaded.',
    };
    render(
      <TaskRow
        task={prTask}
        entry={entry}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText('This pull request could not be loaded.')).toBeInTheDocument();
  });
});

describe('TaskRow — a PR task', () => {
  function okEntry(overrides: Parameters<typeof makePr>[0] = {}): PrEntry {
    const pr = makePr({ number: 4821, ...overrides });
    return { status: 'ok', key: pr.key, tracked: prTask, pr };
  }

  it('shows the title, link, and a ready badge', () => {
    render(
      <TaskRow
        task={prTask}
        entry={okEntry({ reviewDecision: 'APPROVED', ci: 'success' })}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText('Fix index rotation')).toBeInTheDocument();
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#4821' })).toHaveAttribute(
      'href',
      'https://github.com/Example/example-server/pull/4821',
    );
  });

  it('shows a needs action badge for changes requested', () => {
    render(
      <TaskRow
        task={prTask}
        entry={okEntry({ reviewDecision: 'CHANGES_REQUESTED', requestedReviewerCount: 0 })}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText(/needs action/i)).toBeInTheDocument();
  });

  it('shows a merged badge', () => {
    render(
      <TaskRow
        task={prTask}
        entry={okEntry({ lifecycle: 'MERGED' })}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText(/merged/i)).toBeInTheDocument();
  });
});

describe('TaskRow — an issue task', () => {
  const issueTask: TrackedTask = {
    kind: 'issue',
    owner: 'Example',
    repo: 'example-server',
    number: 55,
    addedAt: '2026-08-27T09:00:00Z',
  };

  it('shows the issue title and a waiting badge when open', () => {
    const entry: IssueEntry = {
      status: 'ok',
      key: issueOf().key,
      tracked: issueTask,
      issue: issueOf(),
    };
    render(
      <TaskRow
        task={issueTask}
        entry={entry}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText('Sort order is wrong on empty input')).toBeInTheDocument();
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#55' })).toHaveAttribute(
      'href',
      'https://github.com/Example/example-server/issues/55',
    );
  });

  it('shows a closed badge when the issue is closed', () => {
    const entry: IssueEntry = {
      status: 'ok',
      key: issueOf().key,
      tracked: issueTask,
      issue: issueOf({ lifecycle: 'CLOSED' }),
    };
    render(
      <TaskRow
        task={issueTask}
        entry={entry}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
  });
});

describe('TaskRow — remove and flash', () => {
  it('calls onRemove when the remove button is clicked', async () => {
    const onRemove = vi.fn();
    render(
      <TaskRow
        task={prTask}
        entry={undefined}
        flashed={false}
        onRemove={onRemove}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /remove #4821/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('marks itself flashed via data-flashed', () => {
    render(
      <TaskRow
        task={prTask}
        entry={undefined}
        flashed
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByTestId('task-row')).toHaveAttribute('data-flashed', 'true');
  });
});
