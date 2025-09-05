
export interface NerEntity {
  label: string;   
  index: number;   // word index instead of character position
  text: string;
}

export interface NerResponse { entities: NerEntity[]; }


const DEFAULT_URL = 'http://localhost:8000/detect';

type MockOpts = {

  delayMs?: number;

  errorRate?: number;

  enableHeuristics?: boolean;
};

const DEFAULT_OPTS: Required<MockOpts> = {
  delayMs: 120,
  errorRate: 0,
  enableHeuristics: true,
};


const RX = {
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  PHONE: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g,
  CREDIT_CARD: /\b(?:\d[ -]*?){13,19}\b/g,
  // Singapore NRIC/FIN-ish: S|T|F|G|M + 7 digits + letter
  NRIC: /\b[STFGM]\d{7}[A-Z]\b/g,
  IPV4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  // very loose IPv6 (compressed/uncompressed)
  IPV6: /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{0,4}\b/g,
  URL: /\bhttps?:\/\/[^\s)]+/gi,
  // DOB variants (01/02/1990, 1990-02-01, 1 Feb 1990)
  DOB1: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  DOB2: /\b\d{4}-\d{2}-\d{2}\b/g,
  DOB3: /\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{4}\b/gi,
  // Naive NAME: 1–3 capitalized words (avoid all-caps; excludes start of sentence edge cases)
  NAME: /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2}\b/g,
  // Naive ADDRESS: number + street word
  ADDRESS: /\b\d{1,5}\s+[A-Za-z][A-Za-z\s]*\b(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b/gi,
} as const;

type LabelKey =
  | 'EMAIL' | 'PHONE' | 'CREDIT_CARD' | 'NRIC'
  | 'IPV4' | 'IPV6' | 'URL' | 'DOB' | 'NAME' | 'ADDRESS';

const ORDERED_LABELS: LabelKey[] = [
  // Higher priority first (so they win overlaps)
  'URL', 'EMAIL', 'CREDIT_CARD', 'PHONE', 'NRIC', 'IPV4', 'IPV6', 'DOB', 'ADDRESS', 'NAME',
];

// ──────────────────────── Helpers ───────────────────────────

function* iterMatches(label: LabelKey, rx: RegExp, text: string): Generator<NerEntity> {
  rx.lastIndex = 0;
  let m: RegExpExecArray | null;
  
  // split text into words to get word boundaries
  const words = text.split(/(\s+)/);
  const wordPositions: { start: number; end: number; wordIndex: number }[] = [];
  let charPos = 0;
  let wordIndex = 0;
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (i % 2 === 0) { // non-whitespace word
      wordPositions.push({
        start: charPos,
        end: charPos + word.length,
        wordIndex: wordIndex++
      });
    }
    charPos += word.length;
  }
  
  while ((m = rx.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (end > start) {
      // find which word this match corresponds to
      const wordPos = wordPositions.find(pos => 
        start >= pos.start && start < pos.end
      );
      
      if (wordPos) {
        yield { 
          label, 
          index: wordPos.wordIndex, 
          text: text.slice(start, end) 
        };
      }
    }
    if (!rx.global) break;
  }
}

function collectEntities(text: string, enableHeuristics: boolean): NerEntity[] {
  const ents: NerEntity[] = [];

  // core PII first
  ents.push(...iterMatches('EMAIL', RX.EMAIL, text));
  ents.push(...iterMatches('URL', RX.URL, text));
  ents.push(...iterMatches('CREDIT_CARD', RX.CREDIT_CARD, text));
  ents.push(...iterMatches('PHONE', RX.PHONE, text));
  ents.push(...iterMatches('NRIC', RX.NRIC, text));
  ents.push(...iterMatches('IPV4', RX.IPV4, text));
  ents.push(...iterMatches('IPV6', RX.IPV6, text));
  ents.push(...iterMatches('DOB', RX.DOB1, text));
  ents.push(...iterMatches('DOB', RX.DOB2, text));
  ents.push(...iterMatches('DOB', RX.DOB3, text));

  if (enableHeuristics) {
    ents.push(...iterMatches('ADDRESS', RX.ADDRESS, text));
    ents.push(...iterMatches('NAME', RX.NAME, text));
  }

  // De-duplicate identical word indices/labels
  const seen = new Set<string>();
  const dedup = ents.filter(e => {
    const k = `${e.label}@${e.index}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Resolve overlaps by priority then text length
  const byPriority = new Map<LabelKey, number>();
  ORDERED_LABELS.forEach((l, i) => byPriority.set(l, i));

  dedup.sort((a, b) => {
    const pa = byPriority.get(a.label as LabelKey) ?? 999;
    const pb = byPriority.get(b.label as LabelKey) ?? 999;
    if (pa !== pb) return pa - pb;
    const la = a.text.length;
    const lb = b.text.length;
    if (la !== lb) return lb - la; // longer first
    return a.index - b.index;
  });

  const kept: NerEntity[] = [];
  const usedIndices = new Set<number>();
  for (const e of dedup) {
    if (!usedIndices.has(e.index)) {
      kept.push(e);
      usedIndices.add(e.index);
    } else {
      // overlap—skip lower priority (since sorted) or shorter
      continue;
    }
  }

  // Sort final by word index for nicer UX
  kept.sort((a, b) => a.index - b.index);
  return kept;
}

// ───────────────────── Public API ───────────────────────────

/**
 * Synchronous scanner (useful for unit tests)
 */
export function scanText(text: string, opts?: MockOpts): NerResponse {
  const { enableHeuristics = DEFAULT_OPTS.enableHeuristics } = opts ?? {};
  return { entities: collectEntities(text ?? '', enableHeuristics) };
}

/**
 * Drop-in replacement for your real API client:
 *   import { callRedactApi } from './mockRedactApi';
 *
 * Makes actual HTTP requests to the Flask server.
 */
export async function callRedactApi(
  text: string,
  url: string = DEFAULT_URL,
  opts?: MockOpts
): Promise<NerResponse> {
  const { delayMs, errorRate } = { ...DEFAULT_OPTS, ...(opts || {}) };

  // chaos monkey (for testing error handling)
  if (errorRate > 0 && Math.random() < errorRate) {
    await new Promise(r => setTimeout(r, delayMs));
    throw new Error('NER API 503 (mock)');
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: text })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Add artificial delay if specified
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    
    return result;
  } catch (error) {
    console.error('Error calling redact API:', error);
    
    // Fallback to mock implementation if API call fails
    console.warn('Falling back to mock implementation');
    const result = scanText(text, { enableHeuristics: DEFAULT_OPTS.enableHeuristics });
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    return result;
  }
}
