/**
 * Getting a .toke file to and from disk.
 *
 * Uses a download link and a file input rather than the File System Access
 * API. FSA is Chromium-only and its real advantage — saving over the same
 * file without a dialog — is an enhancement, not a requirement, and it cannot
 * be driven from a test. Recorded as an enhancement in tasks.todo.
 */

export function downloadProject(bytes: Uint8Array, filename: string): void {
  const safe = filename.endsWith('.toke') ? filename : `${filename}.toke`;
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safe;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Revoked on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function readProjectFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Strips the extension for use as a project name. */
export function projectNameFrom(filename: string): string {
  return filename.replace(/\.toke$/i, '');
}
