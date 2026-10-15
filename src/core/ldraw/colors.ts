// LDConfig.ldr: `0 !COLOUR <name> CODE <n> VALUE #RRGGBB EDGE #RRGGBB [ALPHA a] ...`
export interface LdColor {
  code: number;
  name: string;
  value: string;
  edge: string;
  alpha: number;
}

export function parseLdConfig(text: string): Map<number, LdColor> {
  const out = new Map<number, LdColor>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*0\s+!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+(#[0-9A-Fa-f]{6})\s+EDGE\s+(#[0-9A-Fa-f]{6}|\d+)(.*)$/.exec(line);
    if (!m) continue;
    const alpha = /ALPHA\s+(\d+)/.exec(m[5]);
    out.set(Number(m[2]), {
      code: Number(m[2]),
      name: m[1],
      value: m[3].toUpperCase(),
      edge: m[4].startsWith('#') ? m[4].toUpperCase() : '#333333',
      alpha: alpha ? Number(alpha[1]) / 255 : 1,
    });
  }
  return out;
}

/** Vergleichbare Schreibweise für Farbnamen beider Systeme (LDraw: Light_Bluish_Grey, Rebrickable: Light Bluish Gray). */
export function normalizeColorName(name: string): string {
  return name.toLowerCase().replace(/_/g, ' ').replace(/grey/g, 'gray').replace(/\s+/g, ' ').trim();
}
