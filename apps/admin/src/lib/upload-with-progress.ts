const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface UploadResult {
  status: number;
  body: unknown;
}

// fetch() has no upload-progress event at all, so a real per-file progress
// bar (not just a spinner) needs XMLHttpRequest's upload.onprogress instead -
// this is the one call site in the app that can't go through api-client.ts.
export function uploadWithProgress(
  path: string,
  token: string,
  formData: FormData,
  onProgress: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let body: unknown = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Non-JSON response body - leave `body` as {} rather than throwing.
      }
      resolve({ status: xhr.status, body });
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}
