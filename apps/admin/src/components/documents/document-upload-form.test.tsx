import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import { uploadWithProgress } from '@/lib/upload-with-progress';
import { DocumentUploadForm } from './document-upload-form';

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/lib/upload-with-progress', () => ({
  uploadWithProgress: jest.fn(),
}));

const mockUseSession = useSession as jest.Mock;
const mockUploadWithProgress = uploadWithProgress as jest.Mock;

function pdfFile(name = 'past-paper.pdf') {
  return new File(['%PDF-1.4 test content'], name, { type: 'application/pdf' });
}

function submitButton() {
  return screen.getByRole('button', { name: /upload \d*\s*files?/i });
}

function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('DocumentUploadForm', () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue({ data: { accessToken: 'test-admin-token' } });
    mockUploadWithProgress.mockResolvedValue({ status: 201, body: { documentId: 'doc-1', status: 'QUEUED' } });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('disables the upload button when neither a subject nor a file is selected', () => {
    render(<DocumentUploadForm onUploaded={jest.fn()} />);
    expect(submitButton()).toBeDisabled();
  });

  it('keeps the upload button disabled when only a subject is selected', async () => {
    const user = userEvent.setup();
    render(<DocumentUploadForm onUploaded={jest.fn()} />);

    await user.selectOptions(screen.getByLabelText('Subject'), 'Biology');

    expect(submitButton()).toBeDisabled();
  });

  it('keeps the upload button disabled when only a file is selected', async () => {
    const user = userEvent.setup();
    const { container } = render(<DocumentUploadForm onUploaded={jest.fn()} />);

    await user.upload(fileInput(container), pdfFile());

    expect(await screen.findByText('past-paper.pdf')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('enables the upload button once both a subject and a file are present', async () => {
    const user = userEvent.setup();
    const { container } = render(<DocumentUploadForm onUploaded={jest.fn()} />);

    await user.selectOptions(screen.getByLabelText('Subject'), 'Biology');
    await user.upload(fileInput(container), pdfFile());

    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it('rejects a non-PDF file - it never enters the file list', async () => {
    const user = userEvent.setup();
    const { container } = render(<DocumentUploadForm onUploaded={jest.fn()} />);

    const textFile = new File(['not a pdf'], 'notes.txt', { type: 'text/plain' });
    await user.upload(fileInput(container), textFile);

    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('resets the subject when the exam level changes, keeping the button disabled', async () => {
    const user = userEvent.setup();
    const { container } = render(<DocumentUploadForm onUploaded={jest.fn()} />);

    await user.selectOptions(screen.getByLabelText('Subject'), 'Biology');
    await user.upload(fileInput(container), pdfFile());
    await waitFor(() => expect(submitButton()).toBeEnabled());

    await user.click(screen.getByRole('radio', { name: 'A-Level' }));

    expect(submitButton()).toBeDisabled();
  });

  it('submits the file with the selected metadata to the ingest endpoint', async () => {
    const user = userEvent.setup();
    const onUploaded = jest.fn();
    const { container } = render(<DocumentUploadForm onUploaded={onUploaded} />);

    await user.selectOptions(screen.getByLabelText('Subject'), 'Biology');
    await user.type(screen.getByLabelText(/Year/), '2023');
    await user.upload(fileInput(container), pdfFile());
    await waitFor(() => expect(submitButton()).toBeEnabled());

    await user.click(submitButton());

    // Wait for the whole upload (including the post-upload onUploaded() call
    // and its state updates) to settle, not just the mock call, so no state
    // update happens after the test has already finished asserting.
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());

    const [path, token, formData] = mockUploadWithProgress.mock.calls[0];
    expect(path).toBe('/admin/documents/ingest');
    expect(token).toBe('test-admin-token');
    expect(formData.get('subject')).toBe('Biology');
    expect(formData.get('level')).toBe('O_LEVEL');
    expect(formData.get('docType')).toBe('PAST_PAPER');
    expect(formData.get('year')).toBe('2023');
  });
});
