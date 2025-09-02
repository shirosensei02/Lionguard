// Lightweight client for the local Flask redaction server
export default async function redactText(text: string, baseUrl = 'http://127.0.0.1:8000') {
  const res = await fetch(`${baseUrl}/redact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Redact API error ${res.status}: ${msg}`);
  }
  return res.json() as Promise<{
    tokens: string[];
    labels: string[];
    redacted_tokens: string[];
    redacted_text: string;
  }>;
}
