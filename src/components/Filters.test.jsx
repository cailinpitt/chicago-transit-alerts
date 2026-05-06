import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Filters from './Filters.jsx';

const defaultProps = {
  selectedLines: [],
  onLinesChange: vi.fn(),
  showBus: true,
  onShowBusChange: vi.fn(),
  dateRange: 90,
  onDateRangeChange: vi.fn(),
};

describe('Filters', () => {
  it('renders all train line buttons', () => {
    render(<Filters {...defaultProps} />);
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Yellow')).toBeInTheDocument();
  });

  it('calls onLinesChange when a line is toggled', async () => {
    const onLinesChange = vi.fn();
    render(<Filters {...defaultProps} onLinesChange={onLinesChange} />);
    await userEvent.click(screen.getByText('Red'));
    expect(onLinesChange).toHaveBeenCalled();
  });

  it('calls onLinesChange with [] when All lines is clicked', async () => {
    const onLinesChange = vi.fn();
    render(<Filters {...defaultProps} selectedLines={['red']} onLinesChange={onLinesChange} />);
    await userEvent.click(screen.getByText('All lines'));
    expect(onLinesChange).toHaveBeenCalledWith([]);
  });

  it('calls onShowBusChange when Bus is clicked', async () => {
    const onShowBusChange = vi.fn();
    render(<Filters {...defaultProps} onShowBusChange={onShowBusChange} />);
    await userEvent.click(screen.getByText('Bus'));
    expect(onShowBusChange).toHaveBeenCalled();
  });

  it('calls onDateRangeChange with the correct value', async () => {
    const onDateRangeChange = vi.fn();
    render(<Filters {...defaultProps} onDateRangeChange={onDateRangeChange} />);
    await userEvent.click(screen.getByText('30d'));
    expect(onDateRangeChange).toHaveBeenCalledWith(30);
  });
});
