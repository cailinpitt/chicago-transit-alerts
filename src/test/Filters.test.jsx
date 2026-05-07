import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Filters from '../components/Filters.jsx';

const defaultProps = {
  selectedLines: null,
  onLinesChange: vi.fn(),
  showBus: true,
  onShowBusChange: vi.fn(),
  availableBusRoutes: [],
  selectedBusRoutes: [],
  onBusRoutesChange: vi.fn(),
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

  it('hides all trains when Trains is clicked while trains are visible', async () => {
    const onLinesChange = vi.fn();
    render(<Filters {...defaultProps} selectedLines={null} onLinesChange={onLinesChange} />);
    await userEvent.click(screen.getByText('Trains'));
    expect(onLinesChange).toHaveBeenCalledWith([]);
  });

  it('shows all trains when Trains is clicked while trains are hidden', async () => {
    const onLinesChange = vi.fn();
    render(<Filters {...defaultProps} selectedLines={[]} onLinesChange={onLinesChange} />);
    await userEvent.click(screen.getByText('Trains'));
    expect(onLinesChange).toHaveBeenCalledWith(null);
  });

  it('calls onShowBusChange when Bus is clicked', async () => {
    const onShowBusChange = vi.fn();
    render(<Filters {...defaultProps} onShowBusChange={onShowBusChange} />);
    await userEvent.click(screen.getByText('Buses'));
    expect(onShowBusChange).toHaveBeenCalled();
  });

  it('calls onDateRangeChange with the correct value', async () => {
    const onDateRangeChange = vi.fn();
    render(<Filters {...defaultProps} onDateRangeChange={onDateRangeChange} />);
    await userEvent.click(screen.getByText('30d'));
    expect(onDateRangeChange).toHaveBeenCalledWith(30);
  });
});
