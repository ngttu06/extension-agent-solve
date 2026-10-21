import type { PageIdentity, PageSnapshot, SemanticLocator } from './types';

const TRACKING_PARAMS = new Set(['gclid', 'fbclid']);

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeGoal(goal: string): string {
  return normalizeText(goal);
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    const entries = Array.from(url.searchParams.entries())
      .filter(([name]) => !name.toLowerCase().startsWith('utm_') && !TRACKING_PARAMS.has(name.toLowerCase()))
      .sort(([aName, aValue], [bName, bValue]) =>
        aName === bName ? aValue.localeCompare(bValue) : aName.localeCompare(bName),
      );
    url.search = '';
    for (const [name, value] of entries) url.searchParams.append(name, value);
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

export function deriveRouteKey(rawUrl: string): string {
  try {
    const url = new URL(canonicalizeUrl(rawUrl));
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return canonicalizeUrl(rawUrl);
  }
}

export function locatorLandmark(locator: SemanticLocator): string {
  const attrs = locator.attributes;
  return [
    locator.tag,
    locator.role ?? '',
    attrs.type ?? '',
    attrs.name ?? '',
    attrs.autocomplete ?? '',
    normalizeText(locator.accessibleName ?? ''),
    normalizeText(attrs.href ?? ''),
  ].join('|');
}

export function buildPageIdentity(
  snapshot: Pick<PageSnapshot, 'url' | 'elements'>,
  documentId: string,
  revision: number,
): PageIdentity {
  const landmarkHashes = snapshot.elements
    .map((element) => hashString(locatorLandmark(element.locator)))
    .sort();
  return {
    documentId,
    revision,
    canonicalUrl: canonicalizeUrl(snapshot.url),
    routeKey: deriveRouteKey(snapshot.url),
    structureHash: hashString(landmarkHashes.join('|')),
    landmarkHashes,
  };
}

export function landmarkSimilarity(expected: string[], actual: string[]): number {
  if (expected.length === 0 && actual.length === 0) return 1;
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  let intersection = 0;
  for (const hash of expectedSet) if (actualSet.has(hash)) intersection += 1;
  const union = new Set([...expectedSet, ...actualSet]).size;
  return union === 0 ? 1 : intersection / union;
}

export function pageIdentityMatches(
  expected: Pick<PageIdentity, 'canonicalUrl' | 'routeKey' | 'landmarkHashes'>,
  actual: PageIdentity,
  minimumSimilarity = 0.85,
): boolean {
  if (expected.canonicalUrl !== actual.canonicalUrl || expected.routeKey !== actual.routeKey) return false;
  return landmarkSimilarity(expected.landmarkHashes, actual.landmarkHashes) >= minimumSimilarity;
}

export async function buildRecipeKey(goal: string, routeKey: string): Promise<{
  goalHash: string;
  key: string;
}> {
  const [goalHash, routeHash] = await Promise.all([
    sha256(normalizeGoal(goal)),
    sha256(routeKey),
  ]);
  return { goalHash, key: `v1:${goalHash}:${routeHash}` };
}
