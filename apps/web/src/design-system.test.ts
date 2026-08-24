import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Executable design system.
 *
 * The rules live in the header comment of index.css; this file is what stops them
 * eroding. Every constraint here was derived by measuring real rendered contrast in a
 * browser against WCAG 2.1 AA, not by taste — the ratios are in the failure messages so
 * whoever trips one can see why the rule exists rather than just deleting it.
 *
 * Drift is what created the problem in the first place: four neutral ramps, four type
 * scales and 327 failing colour tokens accumulated one reasonable-looking commit at a
 * time. No single change looked wrong. A grep is the cheapest thing that would have
 * caught any of them.
 */

const SRC = join(__dirname);
const DIRS = ['pages', 'components'];

function sourceFiles(): { path: string; name: string; code: string }[] {
  const out: { path: string; name: string; code: string }[] = [];
  for (const dir of DIRS) {
    for (const f of readdirSync(join(SRC, dir))) {
      if (!f.endsWith('.tsx') || f.endsWith('.test.tsx')) continue;
      const path = join(SRC, dir, f);
      out.push({ path, name: `${dir}/${f}`, code: readFileSync(path, 'utf8') });
    }
  }
  return out;
}

/**
 * Icon elements with their classNames removed.
 *
 * Contrast rules govern text, not decorative glyph strokes — gray-400 on a `<FiSearch/>`
 * inside an input is correct and lifting it would change the visual weight of every empty
 * state in the app. Only `<Fi… />` elements are stripped, so a colour on a real text node
 * is still caught.
 */
const stripIcons = (code: string) => code.replace(/<Fi[A-Za-z0-9]+\b[^>]*?\/?>/gs, '');

/** Every line still holding `pattern` after icons are removed, for a readable failure. */
function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const { name, code } of sourceFiles()) {
    stripIcons(code).split('\n').forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${name}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  return hits;
}

const report = (hits: string[], rule: string) =>
  `${rule}\n\n${hits.length} violation(s):\n${hits.slice(0, 25).join('\n')}` +
  (hits.length > 25 ? `\n…and ${hits.length - 25} more` : '');

describe('design system: one neutral ramp', () => {
  it('uses only `gray` — no slate, stone or zinc', () => {
    const hits = offenders(/\b(?:[a-z-]+:)*(?:text|bg|border|border-[trblxyse]|divide|divide-[xy]|ring|from|to|via|outline|placeholder)-(?:slate|stone|zinc)-\d{2,3}\b/);
    expect(hits, report(hits,
      'Four neutral ramps had drifted in. `gray` is the ramp; the others read as a ' +
      'different temperature beside it. Same numeric shade, just swap the hue name.',
    )).toEqual([]);
  });

  it('never puts gray-400 on text (2.60:1, AA needs 4.50)', () => {
    const hits = offenders(/\btext-gray-400\b/);
    expect(hits, report(hits,
      'gray-400 measures 2.60:1 on white and 2.49:1 on the gray-50 page ground. ' +
      'Use gray-500 (4.84:1) for secondary text, or gray-600 (7.56:1) on a tinted ' +
      'ground. gray-400 is fine on <Fi…/> icons, which this check already ignores.',
    )).toEqual([]);
  });
});

describe('design system: semantic colour', () => {
  // Measured on white / gray-50 / own -50 tint. Every one fails somewhere below -700.
  const RATIOS: Record<string, string> = {
    emerald: '3.65', amber: '3.20', green: '3.22', orange: '3.58',
    teal: '3.67', cyan: '3.62', rose: '4.12 on tint', red: '4.36 on tint',
  };

  it('uses -700 for meaning-bearing text, never -500 or -600', () => {
    const hues = Object.keys(RATIOS).join('|');
    const hits = offenders(new RegExp(`\\btext-(?:${hues})-(?:500|600)\\b`));
    expect(hits, report(hits,
      'Semantic text is -700. At -600 these measured: ' +
      Object.entries(RATIOS).map(([h, r]) => `${h} ${r}`).join(', ') +
      '. All clear 4.7:1 at -700. Backgrounds (-50/-100) and fills/borders ' +
      '(-500/-600) are unaffected — this is only about text.',
    )).toEqual([]);
  });

  /**
   * The subtle one. `text-amber-700` clears the floor at 5.03:1, but `text-amber-700/80`
   * composites against its background and lands at 3.51:1 — the shade rule looks obeyed
   * while the result fails. An opacity modifier on a text colour is always really a
   * request for a lighter shade, so pick the shade instead.
   */
  it('never dims text colour with an opacity modifier', () => {
    const hits = offenders(/\btext-(?:amber|emerald|green|red|rose|orange|teal|cyan|gray|blue)-\d{3}\/\d{1,3}\b/);
    expect(hits, report(hits,
      'A /NN opacity modifier silently undoes the shade. amber-700 is 5.03:1; ' +
      'amber-700/80 measured 3.51:1. If the colour is too strong, step DOWN the ramp ' +
      '(-600, -500) so the contrast stays inspectable, rather than fading it.',
    )).toEqual([]);
  });

  it('keeps the brand blue at -600, not -500 (3.76:1)', () => {
    const hits = offenders(/\btext-blue-500\b/);
    expect(hits, report(hits,
      'blue-500 is 3.76:1. Links and accents are blue-600 (5.25:1), which is already ' +
      'the colour used across the app. Blue is deliberately NOT pushed to -700 — it ' +
      'passes as it is, and darkening it would shift the brand.',
    )).toEqual([]);
  });
});

/**
 * The component library is part of the system too.
 *
 * HeroUI's stock palette is a shade lighter than this app needs: its flat Chips already
 * use the -700 step, but ITS -700 is lighter than Tailwind's, so status chips measured
 * 4.08 to 4.48:1 on the tinted grounds they sit on. A bare `heroui()` silently puts all
 * of that back, and nothing else in the codebase would show a diff.
 */
describe('design system: HeroUI theme', () => {
  const theme = readFileSync(join(SRC, 'lib/hero.ts'), 'utf8');

  it.each([
    ['default.500', '#52525b', 'Select/Tabs muted text was 4.40:1 at zinc-500'],
    ['foreground.500', '#52525b', 'same token, same measurement'],
    ['primary', '#155dfc', 'HeroUI #006fee was a SECOND brand blue and read 4.46:1'],
    ['success.700', '#065f46', 'chips measured 4.48:1 at HeroUI\'s lighter -700'],
    ['warning.700', '#92400e', 'chips measured 4.20:1'],
    ['danger.600', '#9f1239', 'chips measured 4.08:1'],
  ])('pins %s to %s', (_token, hex, why) => {
    expect(theme.includes(hex), `${_token} → ${hex}. ${why}.`).toBe(true);
  });

  it('does not fall back to a bare heroui() call', () => {
    expect(
      /heroui\(\s*\)/.test(theme),
      'hero.ts exports `heroui()` with no config, which reverts every measured ' +
      'override above to HeroUI\'s stock palette. Keep the themes.light.colors block.',
    ).toBe(false);
  });
});

describe('design system: three type tiers', () => {
  it('has no text below 11px', () => {
    const hits = offenders(/text-\[(?:[0-9]|10)px\]/);
    expect(hits, report(hits,
      'The tiers are text-[11px] (labels), text-xs (12px body) and text-sm (14px ' +
      'emphasis). 8px, 9px and 10px used to coexist with all three, which collapsed ' +
      'four levels of importance into one indistinguishable visual weight.',
    )).toEqual([]);
  });

  it('keeps 11px as the only arbitrary size', () => {
    const allowed = new Set(['text-[11px]', 'text-[26px]']); // 26px = the budget hero figure
    const found = new Set<string>();
    for (const { code } of sourceFiles()) {
      for (const m of code.matchAll(/text-\[[0-9.]+px\]/g)) {
        if (!allowed.has(m[0])) found.add(m[0]);
      }
    }
    expect([...found], report([...found],
      'Arbitrary type sizes are how the scale fragmented last time. Reach for a ' +
      'Tailwind step (text-xs / text-sm / text-lg) rather than inventing a pixel value.',
    )).toEqual([]);
  });
});
