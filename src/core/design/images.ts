// Prüfung hochgeladener Bildvorlagen: Format aus den Dateibytes (nicht aus Endung oder Dateiname),
// Größe, Prüfsumme. Die Dekodierbarkeit prüft die Oberfläche zusätzlich mit dem Browser-Decoder.
// Bilder bleiben lokal; im Entwurfsauftrag stehen nur Prüfsumme, Typ, Maße und Anzeigename.

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg'] as const;
export type AcceptedType = (typeof ACCEPTED_TYPES)[number];
/** Obergrenze je Bild (auch Grenze des Analysedienstes für Bildeingaben). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;
export const MIN_EDGE_PX = 64;
export const MAX_EDGE_PX = 8000;

/** Dateityp aus den ersten Bytes (Signatur); null = weder PNG noch JPEG. */
export function sniffImageType(bytes: Uint8Array): AcceptedType | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Bildmaße aus dem Dateikopf (PNG: IHDR; JPEG: erstes SOF-Segment). null = Kopf unlesbar. */
export function readImageSize(bytes: Uint8Array, type: AcceptedType): { width: number; height: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png') {
    if (bytes.length < 24 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  let p = 2;
  while (p + 9 < bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1];
    const len = dv.getUint16(p + 2);
    if (len < 2) return null;
    // SOF0…SOF15 außer DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: dv.getUint16(p + 5), width: dv.getUint16(p + 7) };
    p += 2 + len;
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ImageCheck {
  ok: boolean;
  type: AcceptedType | null;
  width: number | null;
  height: number | null;
  errors: string[];
}

/** Prüft eine Bilddatei anhand ihrer Bytes. declaredType ist nur ein Hinweis und wird gegengeprüft. */
export function checkImageBytes(bytes: Uint8Array, declaredType: string): ImageCheck {
  const errors: string[] = [];
  if (bytes.length === 0) return { ok: false, type: null, width: null, height: null, errors: ['Die Datei ist leer.'] };
  if (bytes.length > MAX_IMAGE_BYTES) errors.push(`Die Datei ist ${(bytes.length / 1024 / 1024).toFixed(1)} MB groß; erlaubt sind höchstens ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, type: null, width: null, height: null, errors: [...errors, 'Kein PNG oder JPEG: Der Dateiinhalt hat keine gültige PNG-/JPEG-Signatur (die Dateiendung wird nicht ausgewertet).'] };
  if (declaredType && declaredType !== type && !(declaredType === 'image/jpg' && type === 'image/jpeg')) errors.push(`Angegebener Typ „${declaredType}“ passt nicht zum Inhalt (${type}).`);
  const size = readImageSize(bytes, type);
  if (!size) errors.push('Der Bildkopf ist beschädigt oder unvollständig; Maße nicht lesbar.');
  else {
    if (Math.min(size.width, size.height) < MIN_EDGE_PX) errors.push(`Bild zu klein (${size.width} × ${size.height} px); mindestens ${MIN_EDGE_PX} px je Seite.`);
    if (Math.max(size.width, size.height) > MAX_EDGE_PX) errors.push(`Bild zu groß (${size.width} × ${size.height} px); höchstens ${MAX_EDGE_PX} px je Seite.`);
  }
  return { ok: errors.length === 0, type, width: size?.width ?? null, height: size?.height ?? null, errors };
}
