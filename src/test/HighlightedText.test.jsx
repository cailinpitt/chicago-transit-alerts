import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HighlightedText from '../components/HighlightedText.jsx';

describe('HighlightedText', () => {
  it('returns text untouched when query is empty', () => {
    render(<HighlightedText text="Howard" query="" />);
    expect(screen.getByText('Howard')).toBeInTheDocument();
    expect(screen.queryByRole('mark')).toBeNull();
  });

  it('wraps the matched substring in <mark>', () => {
    render(<HighlightedText text="Red Line Reroute at Howard" query="howard" />);
    const mark = screen.getByText('Howard');
    expect(mark.tagName).toBe('MARK');
  });

  it('matches case-insensitively but preserves original casing', () => {
    render(<HighlightedText text="Howard" query="HOW" />);
    expect(screen.getByText('How').tagName).toBe('MARK');
  });

  it('highlights every occurrence', () => {
    const { container } = render(<HighlightedText text="ababab" query="ab" />);
    expect(container.querySelectorAll('mark')).toHaveLength(3);
  });

  it('handles substrings that are special regex characters as literal text', () => {
    render(<HighlightedText text="Route 8A north" query="8A" />);
    expect(screen.getByText('8A').tagName).toBe('MARK');
  });

  it('returns the original text when there is no match', () => {
    const { container } = render(<HighlightedText text="Howard" query="xyz" />);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(container.textContent).toBe('Howard');
  });

  it('returns null/empty input untouched', () => {
    const { container } = render(<HighlightedText text={null} query="x" />);
    expect(container.textContent).toBe('');
  });
});
