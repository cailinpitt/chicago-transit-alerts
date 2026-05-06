import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Timeline from '../components/Timeline.jsx';

const noop = () => {};

describe('Timeline', () => {
  it('renders a row for each train line', () => {
    render(
      <Timeline alerts={[]} observations={[]} selectedLines={[]} numDays={30} onLineClick={noop} />,
    );
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Yellow')).toBeInTheDocument();
  });

  it('only renders selected lines when a filter is active', () => {
    render(
      <Timeline
        alerts={[]}
        observations={[]}
        selectedLines={['red']}
        numDays={30}
        onLineClick={noop}
      />,
    );
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.queryByText('Blue')).not.toBeInTheDocument();
  });

  it('calls onLineClick with the line key when a label is clicked', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const onLineClick = vi.fn();
    render(
      <Timeline alerts={[]} observations={[]} selectedLines={[]} numDays={30} onLineClick={onLineClick} />,
    );
    await userEvent.click(screen.getByText('Red'));
    expect(onLineClick).toHaveBeenCalledWith('red');
  });

  it('renders the correct number of day columns', () => {
    const { container } = render(
      <Timeline alerts={[]} observations={[]} selectedLines={[]} numDays={7} onLineClick={noop} />,
    );
    // Each row has numDays cells; check one row (Red line)
    const redRow = screen.getByText('Red').closest('tr');
    // 1 label cell + 7 day cells
    expect(redRow.querySelectorAll('td')).toHaveLength(8);
  });
});
