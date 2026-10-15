// Import einer LDraw-/MPD-Datei (z. B. aus dem LDraw-OMR) in das kanonische Modell.
// - `0 STEP` → Bauschritt; MPD-Untermodelle → separat gebaute Baugruppen.
// - Ohne jegliche STEP-Angabe gilt die Baufolge als nicht belegt (steps = []).
import { compose, IDENTITY, type Transform } from '../math';
import { normalizeName, parseMpd, type LdFile, type SubfileRef } from '../ldraw/parse';
import { defaultUsage, MODEL_SCHEMA, type Assembly, type CanonicalModel, type ModelOrigin, type PartInstance, type StepDef } from './types';

export interface ImportOptions {
  modelId: string;
  name: string;
  origin: ModelOrigin;
  fileName: string;
}

function slug(s: string): string {
  return normalizeName(s).replace(/\.(ldr|dat|mpd)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function importLdraw(text: string, opts: ImportOptions): CanonicalModel {
  const files = parseMpd(text, opts.fileName);
  const byName = new Map<string, LdFile>(files.map((f) => [f.name, f]));
  const instances: PartInstance[] = [];
  const assemblies: Assembly[] = [];
  const steps: StepDef[] = [];
  const hasSteps = files.some((f) => f.lines.some((l) => l.type === 'step'));
  const usedAssemblyIds = new Set<string>();
  const source = `${opts.fileName}`;

  const build = (file: LdFile, t: Transform, assemblyId: string) => {
    // Zeilen in Schrittgruppen aufteilen
    const groups: SubfileRef[][] = [[]];
    for (const line of file.lines) {
      if (line.type === 'step') groups.push([]);
      else if (line.type === 1) groups[groups.length - 1].push(line);
    }
    let k = 0;
    for (const group of groups) {
      const add: string[] = [];
      const attach: string[] = [];
      for (const ref of group) {
        const local: Transform = { position: ref.position, rotation: ref.rotation };
        const world = compose(t, local);
        const sub = byName.get(normalizeName(ref.file));
        if (sub) {
          let childId = `${assemblyId}>${slug(sub.name)}`;
          for (let n = 2; usedAssemblyIds.has(childId); n++) childId = `${assemblyId}>${slug(sub.name)}@${n}`;
          usedAssemblyIds.add(childId);
          assemblies.push({ assemblyId: childId, name: sub.title ?? sub.name, parentId: assemblyId, builtSeparately: true, separateModule: false, source: `MPD-Untermodell „${sub.name}“ (Zeile ${ref.lineNo})` });
          build(sub, world, childId);
          attach.push(childId);
        } else {
          const instanceId = `${assemblyId}/L${ref.lineNo}`;
          instances.push({ instanceId, part: normalizeName(ref.file).replace(/\.dat$/, ''), color: ref.color, position: world.position, rotation: world.rotation, assemblyId });
          add.push(instanceId);
        }
      }
      if (add.length || attach.length) {
        k++;
        steps.push({ stepId: `${assemblyId}#${k}`, assemblyId, add, attach, source: `${source}: ${file.name}, STEP-Gruppe ${k}` });
      }
    }
  };

  const main = files[0];
  const rootId = 'main';
  usedAssemblyIds.add(rootId);
  assemblies.push({ assemblyId: rootId, name: main.title ?? opts.name, parentId: null, builtSeparately: false, separateModule: false, source: `Hauptdatei „${main.name}“` });
  build(main, { position: [0, 0, 0], rotation: IDENTITY }, rootId);

  return {
    schema: MODEL_SCHEMA,
    modelId: opts.modelId,
    version: 1,
    name: opts.name,
    origin: opts.origin,
    units: 'LDU',
    coordinateSystem: 'ldraw-right-handed-negative-y-up',
    rootAssemblyId: rootId,
    instances,
    assemblies,
    steps: hasSteps ? steps : [],
    stepsSource: hasSteps ? 'source-file' : 'none',
    usage: defaultUsage(),
    changeLog: [],
  };
}
