import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../src/store/useAppStore';
import { ExportButton } from '../../src/ui/ExportButton';
import { strings } from '../../src/ui/strings';

beforeEach(() => {
  useAppStore.getState().reset();
});

test('is disabled while the avatar is loading', () => {
  render(<ExportButton />);
  expect(screen.getByTestId('export-button')).toBeDisabled();
});

test('is enabled when the avatar is ready and labelled from strings', () => {
  useAppStore.getState().setAvatarStatus('ready');
  render(<ExportButton />);
  const button = screen.getByTestId('export-button');
  expect(button).toBeEnabled();
  expect(button).toHaveTextContent(strings.saveImage);
});

test('is disabled on error', () => {
  useAppStore.getState().setAvatarStatus('error', 'x');
  render(<ExportButton />);
  expect(screen.getByTestId('export-button')).toBeDisabled();
});
