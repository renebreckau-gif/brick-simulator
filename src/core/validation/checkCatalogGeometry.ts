// Schichten „Katalog & Farbe“, „Teilgeometrie“ und Anschlussmerkmale außerhalb des Regelumfangs.
import type { Catalog } from '../catalog/catalog';
import { PART_META_VERSION } from '../connectivity/partMeta';
import { counterpartKinds, isImplementedKind, RULES_VERSION, type ConnectorKind } from '../connectivity/rules';
import { boxesTouch, det, dist, orthonormalityError } from '../math';
import type { CanonicalModel } from '../model/types';
import { TOLERANCE } from '../units';
import { affected, finding, type Finding } from './findings';
import { allBoxes, type World } from './world';

export function checkCatalog(model: CanonicalModel, catalog: Catalog): Finding[] {
  if (!catalog.available) return [catalogSourceFinding(model, catalog), ...checkSimulationSupport(model, catalog)];
  return [...checkCatalogEvidence(model, catalog), ...checkSimulationSupport(model, catalog)];
}

/** Kein (gültiger) Katalog: Existenz, Farbe, Teil-Farb-Belege und Inventarabgleich bleiben ungeprüft. */
function catalogSourceFinding(model: CanonicalModel, catalog: Catalog): Finding {
  const corrupt = catalog.source.state === 'corrupt';
  return finding({
    code: corrupt ? 'CAT_SOURCE_CORRUPT' : 'CAT_SOURCE_UNAVAILABLE', layer: 'catalog', dimension: 'data', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
    title: corrupt ? 'Katalogauszug beschädigt – nicht verwendet' : 'Kein Katalog geladen – Katalogprüfungen ungeprüft',
    message: corrupt
      ? `${catalog.source.state === 'corrupt' ? catalog.source.error : ''}. Teilexistenz, Farbzuordnung, Teil-Farb-Belege und Inventarabgleich bleiben ungeprüft.`
      : `Für ${model.instances.length} Teile bleiben Katalogexistenz, Farbzuordnung zu Rebrickable, Teil-Farb-Belege und Inventarabgleich ungeprüft. Geometrie, Verbindungen und Montage sind davon nicht betroffen.`,
    affected: affected(model.instances.map((i) => i.instanceId)), ruleVersion: catalog.version,
    evidence: { source: catalog.source },
    limitation: 'Fehlende Katalogdaten belegen weder Existenz noch Nichtexistenz einer Teil-Farb-Kombination.',
    remedy: corrupt ? 'Auszug mit scripts/extract-rebrickable.mjs neu erzeugen.' : 'Optional: Katalogauszug lokal erzeugen (siehe README, Rebrickable-Bedingungen beachten).',
  });
}

function checkCatalogEvidence(model: CanonicalModel, catalog: Catalog): Finding[] {
  const out: Finding[] = [];
  const unknownParts = new Map<string, string[]>();
  const unmappedColors = new Map<number, string[]>();
  const unevidenced = new Map<string, string[]>();
  let evidenced = 0;
  for (const i of model.instances) {
    const p = catalog.part(i.part);
    if (p.catalogStatus === 'unknown') (unknownParts.get(i.part) ?? unknownParts.set(i.part, []).get(i.part)!).push(i.instanceId);
    const c = catalog.color(i.color);
    if (!c || c.rebrickableId === null) (unmappedColors.get(i.color) ?? unmappedColors.set(i.color, []).get(i.color)!).push(i.instanceId);
    if (p.catalogStatus === 'known' && c?.rebrickableId != null) {
      const ev = catalog.partColorEvidence(i.part, i.color);
      if (ev.status === 'evidenced') evidenced++;
      else (unevidenced.get(`${i.part}|${i.color}`) ?? unevidenced.set(`${i.part}|${i.color}`, []).get(`${i.part}|${i.color}`)!).push(i.instanceId);
    }
  }
  for (const [part, ids] of unknownParts)
    out.push(finding({
      code: 'CAT_PART_UNKNOWN', layer: 'catalog', dimension: 'data', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
      title: `Teil ${part} nicht im Katalogauszug`,
      message: `Die LDraw-Nummer ${part} ist keinem belegten Katalogeintrag zugeordnet. Existenz, Farbe und Beschaffung bleiben ungeprüft.`,
      affected: affected(ids), ruleVersion: catalog.version,
      evidence: { ldrawId: part, mapping: 'keine' },
      limitation: 'Der Katalogauszug enthält nur die Teile des Phase-1-Umfangs.',
      remedy: 'Teil in data/catalog/id-map.json aufnehmen und Auszug neu erzeugen, falls belegbar.',
    }));
  for (const [code, ids] of unmappedColors)
    out.push(finding({
      code: 'CAT_COLOR_UNMAPPED', layer: 'catalog', dimension: 'data', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
      title: `Farbcode ${code} ohne Katalogzuordnung`,
      message: `Für den LDraw-Farbcode ${code} gibt es keine belegte Zuordnung zu einer Rebrickable-Farbe. Teil-Farb-Kombination und Stückliste sind für diese Teile nicht auflösbar.`,
      affected: affected(ids), ruleVersion: catalog.version,
      evidence: { ldrawCode: code, ldConfig: catalog.color(code)?.ldrawName ?? 'nicht in LDConfig.ldr (z. B. direkte RGB-Farbe)' },
      remedy: 'Reale Katalogfarbe wählen oder Zuordnung belegen.',
    }));
  for (const [k, ids] of unevidenced) {
    const [part, color] = k.split('|');
    out.push(finding({
      code: 'CAT_COMBO_UNEVIDENCED', layer: 'catalog', dimension: 'data', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
      title: `Kombination ${part} in Farbe ${color} nicht belegt`,
      message: 'Weder eine LEGO-Element-ID noch ein Set-Inventar belegt diese Teil-Farb-Kombination im Katalogauszug.',
      affected: affected(ids), ruleVersion: catalog.version,
      evidence: catalog.partColorEvidence(part, Number(color)) as unknown as Record<string, unknown>,
      limitation: 'Fehlender Beleg heißt nicht, dass die Kombination nicht existiert.',
      remedy: 'Belegte Farbe wählen oder externen Beleg ergänzen.',
    }));
  }
  if (evidenced > 0)
    out.push(finding({
      code: 'CAT_COMBO_EVIDENCED', layer: 'catalog', dimension: 'data', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
      title: `${evidenced} Teil-Farb-Zuordnungen belegt`,
      message: catalog.source.state === 'loaded' && catalog.source.kind === 'test-fixture'
        ? 'Belegt nur in der synthetischen TESTFIXTURE – kein Nachweis für reale Teile.'
        : 'Teil und Farbe sind über Element-ID oder Set-Inventar im Rebrickable-Auszug belegt.',
      ruleVersion: catalog.version,
      evidence: { instances: evidenced, source: catalog.source },
      limitation: 'Beleg der Existenz – keine Aussage über aktuelle Kaufverfügbarkeit.',
    }));
  return out;
}

/** Simulationsunterstützung (aus eigenen Teil-Metadaten, unabhängig vom Katalog). */
function checkSimulationSupport(model: CanonicalModel, catalog: Catalog): Finding[] {
  const out: Finding[] = [];
  const bySupport = new Map<string, string[]>();
  for (const i of model.instances) {
    const s = catalog.part(i.part).simulation;
    if (s === 'supported') continue;
    (bySupport.get(`${s}|${i.part}`) ?? bySupport.set(`${s}|${i.part}`, []).get(`${s}|${i.part}`)!).push(i.instanceId);
  }
  for (const [k, ids] of bySupport) {
    const [s, part] = k.split('|');
    const meta = catalog.part(part).meta;
    out.push(finding({
      code: s === 'partial' ? 'CAT_SIM_PARTIAL' : 'CAT_SIM_UNSUPPORTED', layer: 'catalog', dimension: 'data', status: 'unsupported', severity: 'warning', evidenceLevel: 'unchecked',
      title: s === 'partial' ? `Teil ${part}: nur teilweise simuliert` : `Teil ${part}: Simulation nicht unterstützt`,
      message: s === 'partial'
        ? `Noppen/Aufnahmen werden geprüft; nicht unterstützt: ${meta?.unsupportedFeatures.join('; ')}.`
        : `Für ${part} sind keine Anschlussregeln implementiert${s === 'none' ? ' und keine Geometrie geladen' : ''}. Verbindungen und Kollisionen mit diesem Teil bleiben ungeprüft.`,
      affected: affected(ids), ruleVersion: PART_META_VERSION,
      evidence: { simulation: s, features: meta?.unsupportedFeatures ?? [] },
      limitation: 'Katalogexistenz ist unabhängig davon belegt bzw. ungeprüft (siehe Katalogbefunde).',
    }));
  }
  return out;
}

export function checkGeometry(world: World): Finding[] {
  const out: Finding[] = [];
  const deformed: string[] = [];
  const mirrored: string[] = [];
  const free: string[] = [];
  const noGeo: string[] = [];
  for (const w of world.instances.values()) {
    const err = orthonormalityError(w.inst.rotation);
    if (err > TOLERANCE.matrix) deformed.push(w.inst.instanceId);
    else if (det(w.inst.rotation) < 0) mirrored.push(w.inst.instanceId);
    else if (!w.axisAligned) free.push(w.inst.instanceId);
    if (!w.part.geometryAvailable) noGeo.push(w.inst.instanceId);
  }
  if (deformed.length)
    out.push(finding({
      code: 'GEO_DEFORMED', layer: 'geometry', dimension: 'assembly', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
      title: 'Teil skaliert oder verformt', message: 'Die Rotationsmatrix ist nicht orthonormal – das Teil wurde skaliert/geschert. Reale Teile dürfen nur verschoben und gedreht werden.',
      affected: affected(deformed), ruleVersion: 'geometry@1', evidence: { tolerance: TOLERANCE.matrix },
      remedy: 'Ursprüngliche Teilgröße verwenden; passendes reales Teil wählen.',
    }));
  if (mirrored.length)
    out.push(finding({
      code: 'GEO_MIRRORED', layer: 'geometry', dimension: 'assembly', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
      title: 'Teil gespiegelt', message: 'Determinante < 0: ein gespiegeltes Teil ist physisch kein identisches Teil.',
      affected: affected(mirrored), ruleVersion: 'geometry@1', remedy: 'Spiegelung entfernen oder spiegelbildliches Realteil verwenden.',
    }));
  if (free.length)
    out.push(finding({
      code: 'GEO_FREE_ROTATION', layer: 'geometry', dimension: 'assembly', status: 'unsupported', severity: 'warning', evidenceLevel: 'unchecked',
      title: 'Frei gedrehte Platzierung', message: 'Teile, die nicht in 90°-Schritten ausgerichtet sind, liegen außerhalb des unterstützten Umfangs; ihre Verbindungen werden nicht gewertet.',
      affected: affected(free), ruleVersion: 'geometry@1',
    }));
  if (noGeo.length)
    out.push(finding({
      code: 'GEO_UNAVAILABLE', layer: 'geometry', dimension: 'data', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
      title: 'Keine LDraw-Geometrie geladen', message: 'Für diese Teile liegt keine Geometrie vor; Darstellung erfolgt als Platzhalter.',
      affected: affected(noGeo), ruleVersion: 'geometry@1',
    }));
  if (!deformed.length && !mirrored.length)
    out.push(finding({
      code: 'GEO_RIGID_OK', layer: 'geometry', dimension: 'assembly', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
      title: 'Alle Teile unverformt', message: 'Alle Rotationen sind orthonormal und nicht gespiegelt.', ruleVersion: 'geometry@1',
      evidence: { instances: world.instances.size, tolerance: TOLERANCE.matrix },
    }));
  return out;
}

/** Reichweite (LDU), in der ein Technic-Gegenstück als „möglicherweise verbunden“ gilt (Pinlänge ≈ 20 LDU);
 *  koaxiale Techniken (Hohlnoppe ↔ Unterseitenstift) nutzen die Positionstoleranz. */
const TECHNIC_REACH = 12;

const KIND_LABEL: Partial<Record<ConnectorKind, string>> = {
  technic_pin: 'Technic-Pin',
  technic_pin_hole: 'Technic-Pinloch',
  bar_holder: 'Hohlnoppe (Halter)',
  underside_pin: 'Unterseitenstift',
};

/** Nicht unterstützte Anschlussmerkmale mit erreichbarem Gegenstück → Verbindung ungeprüft. */
export function checkUnsupportedConnectors(world: World): Finding[] {
  const out: Finding[] = [];
  const list = [...world.instances.values()];
  for (const w of list) {
    const isUnsupportedPart = w.part.simulation === 'unsupported' || w.part.simulation === 'none';
    // Nicht implementierte Anschlüsse, für die ein Nachbar ein passendes Gegenstück in Reichweite hat
    const used = w.connectors.filter((c) => !isImplementedKind(c.def.kind)).flatMap((c) => {
      const kinds = counterpartKinds(c.def.kind);
      const reach = c.def.kind.startsWith('technic') ? TECHNIC_REACH : TOLERANCE.connectorPosition;
      const hits = list.filter((o) => o !== w && o.connectors.some((oc) => kinds.includes(oc.def.kind) && dist(oc.position, c.position) <= reach));
      return hits.length ? [{ c, hits }] : [];
    });
    if (!used.length && !isUnsupportedPart) continue;
    const unsupportedConnectors = used.map((u) => u.c);
    const neighbors = isUnsupportedPart
      ? list.filter((o) => o !== w && allBoxes(o).some((ob) => allBoxes(w).some((wb) => boxesTouch(wb.box, ob.box, TOLERANCE.contact)))).map((o) => o.inst.instanceId)
      : [...new Set(used.flatMap((u) => u.hits.map((h) => h.inst.instanceId)))].sort();
    out.push(finding({
      code: 'CON_UNSUPPORTED_FEATURE', layer: 'connection', dimension: 'assembly', status: 'unsupported', severity: 'warning', evidenceLevel: 'unchecked',
      title: isUnsupportedPart ? `${w.inst.part}: Anschlüsse nicht modelliert` : `${w.inst.part}: ${[...new Set(unsupportedConnectors.map((c) => KIND_LABEL[c.def.kind] ?? c.def.kind))].join(', ')} – nicht unterstützt`,
      message: neighbors.length
        ? `Mögliche Verbindung zu ${neighbors.length} Nachbarteil(en) über eine nicht implementierte Technik – ungeprüft.`
        : 'Nicht unterstütztes Merkmal ohne erkennbaren Nachbarkontakt.',
      affected: affected([w.inst.instanceId, ...neighbors]), ruleVersion: RULES_VERSION,
      evidence: { features: w.meta?.unsupportedFeatures ?? [], neighbors },
      limitation: 'Technic-, Stangen-, Clip-, Scharnier- und SNOT-Verbindungen sind in Phase 1 nur im Datenmodell erfasst.',
    }));
  }
  const n = world.connections.length;
  out.push(finding({
    code: 'CON_REGULAR', layer: 'connection', dimension: 'assembly', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
    title: `${n} reguläre Steckverbindungen erkannt`,
    message: `Noppe↔Aufnahme: ${world.connections.filter((c) => c.ruleId === 'R-STUD-ANTISTUD').length}, Noppe↔Röhre (Halbnoppenversatz): ${world.connections.filter((c) => c.ruleId === 'R-STUD-TUBE').length}.`,
    ruleVersion: RULES_VERSION, evidence: { tolerance: TOLERANCE.connectorPosition },
  }));
  return out;
}
