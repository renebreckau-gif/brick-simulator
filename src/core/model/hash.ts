// Deterministischer Inhalts-Hash der konstruktiven Modellanteile.
// cyrb53 (53 Bit, nicht kryptografisch) – genügt zur Erkennung veralteter Artefakte.
import type { CanonicalModel, ModelRef } from './types';

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Hash über alles, was Konstruktion, Baufolge oder Nutzung betrifft (nicht Name/Änderungsprotokoll). */
export function contentHash(m: CanonicalModel): string {
  const instances = [...m.instances].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  return cyrb53(stableStringify({ instances, assemblies: m.assemblies, steps: m.steps, usage: m.usage, root: m.rootAssemblyId, generator: m.generator }));
}

export function modelRef(m: CanonicalModel): ModelRef {
  return { modelId: m.modelId, version: m.version, contentHash: contentHash(m) };
}

export function sameModelVersion(a: ModelRef, b: ModelRef): boolean {
  return a.modelId === b.modelId && a.version === b.version && a.contentHash === b.contentHash;
}
