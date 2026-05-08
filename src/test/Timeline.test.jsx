import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Timeline from '../components/Timeline.jsx';

const noop = () => {};

describe('Timeline', () => {
  it('renders a row for each train line', () => {
    render(
      <Timeline
        alerts={[]}
        observations={[]}
        selectedLines={null}
        numDays={30}
        onLineClick={noop}
      />,
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

  it('renders no train rows when selectedLines is empty array', () => {
    render(
      <Timeline alerts={[]} observations={[]} selectedLines={[]} numDays={30} onLineClick={noop} />,
    );
    expect(screen.queryByText('Red')).not.toBeInTheDocument();
    expect(screen.queryByText('Yellow')).not.toBeInTheDocument();
  });

  it('renders line labels as links to /line/:id', () => {
    render(
      <Timeline
        alerts={[]}
        observations={[]}
        selectedLines={null}
        numDays={30}
        onLineClick={noop}
      />,
    );
    const redLink = screen.getByText('Red').closest('a');
    expect(redLink).toBeInTheDocument();
    expect(redLink).toHaveAttribute('href', '/line/red');
  });

  it('renders the correct number of day columns', () => {
    render(
      <Timeline
        alerts={[]}
        observations={[]}
        selectedLines={null}
        numDays={7}
        onLineClick={noop}
      />,
    );
    // Each row has numDays cells; check one row (Red line)
    const redRow = screen.getByText('Red').closest('tr');
    // 1 label cell + 7 day cells
    expect(redRow.querySelectorAll('td')).toHaveLength(8);
  });
});
