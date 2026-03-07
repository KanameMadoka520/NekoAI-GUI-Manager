function pad(n: number) {
  return String(n).padStart(2, '0');
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function stripExt(filename: string) {
  return filename.replace(/\.[^.]+$/, '');
}

function triggerDownload(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJsonWithTimestamp(data: unknown, originalFilename: string) {
  const filename = `${stripExt(originalFilename)}_${timestamp()}.json`;
  const json = JSON.stringify(data, null, 2);
  triggerDownload(json, 'application/json', filename);
}

export function downloadTextWithTimestamp(
  content: string,
  originalFilename: string,
  mime = 'text/plain',
  extension?: string,
) {
  const ext = extension ?? (originalFilename.match(/\.([^.]+)$/)?.[1] ?? 'txt');
  const filename = `${stripExt(originalFilename)}_${timestamp()}.${ext}`;
  triggerDownload(content, mime, filename);
}

export async function pickJsonAndParse(): Promise<{ data: unknown; fileName: string } | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';

  const file = await new Promise<File | null>((resolve) => {
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });

  if (!file) return null;

  const text = await file.text();
  return { data: JSON.parse(text), fileName: file.name };
}
