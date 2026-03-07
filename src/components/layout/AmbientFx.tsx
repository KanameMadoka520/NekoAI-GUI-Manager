import { useMemo } from 'react';

type ThemeName = 'light' | 'dark' | 'parchment';

const CHAR_POOL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const THEME_PROFILE: Record<ThemeName, { symbols: string[]; types: string[] }> = {
  light: {
    symbols: ['::', '=>', '..', '&&', '||', '??', '__'],
    types: ['node', 'flux', 'echo', 'vector', 'trace', 'cache', 'pulse', 'frame'],
  },
  dark: {
    symbols: ['->', '=>', '<<', '>>', '&&', '||', '::', '??'],
    types: ['kernel', 'shadow', 'cipher', 'stack', 'proxy', 'mesh', 'relay', 'delta'],
  },
  parchment: {
    symbols: ['::', '~>', '..', '=>', '__', '&&', '<>'],
    types: ['ink', 'folio', 'glyph', 'scribe', 'ledger', 'quill', 'echo', 'amber'],
  },
};

interface Particle {
  id: number;
  left: number;
  top: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  rotate: number;
  opacity: number;
  char: string;
  motif?: number;
}

interface Zone {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface AmbientFxProps {
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  theme?: ThemeName;
  density?: 'low' | 'medium' | 'high';
  stylePreset?: 'network' | 'orbital' | 'blueprint' | 'auto';
  enabled?: boolean;
}

function seeded(i: number) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function randomFrom<T>(arr: T[], r: number): T {
  return arr[Math.floor(r * arr.length) % arr.length];
}

function randomChars(seedBase: number, len: number) {
  let out = '';
  for (let i = 0; i < len; i++) {
    const r = seeded(seedBase + i * 13);
    out += CHAR_POOL[Math.floor(r * CHAR_POOL.length)];
  }
  return out;
}

function fromZone(zone: Zone, r1: number, r2: number) {
  return {
    left: zone.x0 + (zone.x1 - zone.x0) * r1,
    top: zone.y0 + (zone.y1 - zone.y0) * r2,
  };
}

function targetLength(idx: number) {
  const r = seeded(idx + 4101);
  // 65% 中短串，25% 长串，10% 极短串
  if (r < 0.1) return 4 + Math.floor(seeded(idx + 4201) * 2); // 4-5
  if (r < 0.75) return 8 + Math.floor(seeded(idx + 4301) * 6); // 8-13
  return 14 + Math.floor(seeded(idx + 4401) * 8); // 14-21
}

function fitLength(str: string, idx: number) {
  const wanted = targetLength(idx);
  if (str.length === wanted) return str;
  if (str.length > wanted) return str.slice(0, wanted);
  return `${str}${randomChars(idx + 4501, wanted - str.length)}`;
}

function makePseudoCode(idx: number, theme: ThemeName) {
  const profile = THEME_PROFILE[theme];
  const r = seeded(idx + 3001);
  const r2 = seeded(idx + 3019);
  const r3 = seeded(idx + 3037);
  const r4 = seeded(idx + 3061);

  const head = randomFrom(profile.types, r);
  const tail = randomFrom(profile.types, r2);
  const sym = randomFrom(profile.symbols, r3);

  let raw = '';

  if (r4 < 0.16) {
    raw = `${head}.${tail}(${randomChars(idx + 5000, 3)})`;
  } else if (r4 < 0.32) {
    raw = `${head}_${randomChars(idx + 5100, 4)}${sym}${Math.floor(seeded(idx + 5200) * 999)}`;
  } else if (r4 < 0.48) {
    raw = `${head}<${randomChars(idx + 5300, 2)}>${sym}${tail}`;
  } else if (r4 < 0.64) {
    raw = `${head}[${Math.floor(seeded(idx + 5400) * 64)}]${sym}${randomChars(idx + 5500, 3)}`;
  } else if (r4 < 0.8) {
    raw = `${head}${sym}${tail}.${randomChars(idx + 5600, 4)}`;
  } else {
    raw = `${head}:${randomChars(idx + 5700, 2)}${sym}${tail}_${randomChars(idx + 5800, 2)}`;
  }

  return fitLength(raw, idx);
}

function buildParticles(count: number, offset: number, zone: Zone, glyphMode: boolean, theme: ThemeName): Particle[] {
  return Array.from({ length: count }).map((_, i) => {
    const idx = offset + i;
    const r1 = seeded(idx + 11);
    const r2 = seeded(idx + 97);
    const r3 = seeded(idx + 211);
    const pos = fromZone(zone, r1, r2);
    return {
      id: idx,
      left: pos.left,
      top: pos.top,
      size: glyphMode ? 10 + r3 * 12 : 16 + r3 * 42,
      duration: (glyphMode ? 14 : 18) + seeded(idx + 17) * (glyphMode ? 22 : 26),
      delay: seeded(idx + 33) * (glyphMode ? -25 : -30),
      drift: (glyphMode ? -30 : -45) + seeded(idx + 51) * (glyphMode ? 60 : 90),
      rotate: (glyphMode ? -25 : -35) + seeded(idx + 71) * (glyphMode ? 50 : 70),
      opacity: glyphMode
        ? (0.08 + seeded(idx + 81) * 0.22)
        : (0.12 + seeded(idx + 81) * 0.28),
      char: glyphMode ? makePseudoCode(idx, theme) : '',
      motif: glyphMode ? undefined : Math.floor(seeded(idx + 5901) * 4),
    };
  });
}

export function AmbientFx({
  sidebarCollapsed = false,
  sidebarWidth = 224,
  theme = 'light',
  density = 'medium',
  stylePreset = 'auto',
  enabled = true,
}: AmbientFxProps) {
  if (!enabled) return null;
  const baseScale = 0.7;
  const densityScale = (density === 'low' ? 0.65 : density === 'high' ? 1.35 : 1) * baseScale;
  const sidebarPct = sidebarCollapsed
    ? 7
    : Math.max(12, Math.min(30, (sidebarWidth / 1200) * 100));

  const resolvedPreset = stylePreset === 'auto'
    ? (theme === 'light' ? 'network' : theme === 'dark' ? 'orbital' : 'blueprint')
    : stylePreset;

  const titleZone: Zone = { x0: 0, x1: 100, y0: 0, y1: 6 };
  const sidebarZone: Zone = { x0: 0, x1: sidebarPct, y0: 6, y1: 100 };
  const mainZone: Zone = { x0: sidebarPct, x1: 100, y0: 6, y1: 100 };

  const glyphs = useMemo<Particle[]>(() => {
    return [
      ...buildParticles(Math.max(6, Math.round(84 * densityScale)), 0, mainZone, true, theme),
      ...buildParticles(Math.max(4, Math.round(22 * densityScale)), 2000, sidebarZone, true, theme),
      ...buildParticles(Math.max(3, Math.round(14 * densityScale)), 4000, titleZone, true, theme),
    ];
  }, [sidebarPct, theme, densityScale]);

  const shapes = useMemo<Particle[]>(() => {
    return [
      ...buildParticles(Math.max(4, Math.round(44 * densityScale)), 6000, mainZone, false, theme),
      ...buildParticles(Math.max(2, Math.round(14 * densityScale)), 8000, sidebarZone, false, theme),
      ...buildParticles(Math.max(1, Math.round(6 * densityScale)), 10000, titleZone, false, theme),
    ];
  }, [sidebarPct, theme, densityScale]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-0" aria-hidden>
      {glyphs.map((p) => (
        <span
          key={`g-${p.id}`}
          className="ambient-glyph"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            fontSize: `${p.size * 0.92}px`,
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            ['--ambient-drift' as any]: `${p.drift}px`,
            ['--ambient-size' as any]: `${p.size}px`,
            ['--ambient-rotate' as any]: `${p.rotate}deg`,
            ['--ambient-float-duration' as any]: `${p.duration}s`,
          }}
        >
          {p.char}
        </span>
      ))}

      {shapes.map((p) => (
        <span
          key={`s-${p.id}`}
          className="ambient-shape"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            ['--ambient-drift' as any]: `${p.drift}px`,
            ['--ambient-size' as any]: `${p.size}px`,
            ['--ambient-rotate' as any]: `${p.rotate}deg`,
            ['--ambient-float-duration' as any]: `${p.duration}s`,
          }}
        >
          {resolvedPreset === 'network' && p.motif === 0 && (
            <svg viewBox="0 0 100 100" className="ambient-svg" preserveAspectRatio="none">
              <path d="M10 75 L45 20 L90 70" className="ambient-line" />
              <circle cx="45" cy="20" r="5" className="ambient-node" />
              <circle cx="10" cy="75" r="4" className="ambient-node" />
              <circle cx="90" cy="70" r="4" className="ambient-node" />
            </svg>
          )}
          {resolvedPreset === 'network' && p.motif === 1 && (
            <svg viewBox="0 0 100 100" className="ambient-svg" preserveAspectRatio="none">
              <path d="M8 60 C20 10, 80 10, 92 60 C80 90, 20 90, 8 60 Z" className="ambient-line" />
              <path d="M26 62 L50 30 L74 62" className="ambient-line-thin" />
            </svg>
          )}
          {resolvedPreset === 'network' && p.motif === 2 && (
            <svg viewBox="0 0 100 100" className="ambient-svg" preserveAspectRatio="none">
              <path d="M12 20 L82 20 L92 35 L22 35 Z" className="ambient-line-thin" />
              <path d="M8 62 L78 62 L88 78 L18 78 Z" className="ambient-line" />
              <path d="M20 35 L30 62" className="ambient-link" />
              <path d="M86 35 L76 62" className="ambient-link" />
            </svg>
          )}
          {resolvedPreset === 'network' && p.motif === 3 && (
            <svg viewBox="0 0 100 100" className="ambient-svg" preserveAspectRatio="none">
              <circle cx="50" cy="50" r="30" className="ambient-line" />
              <circle cx="50" cy="50" r="12" className="ambient-line-thin" />
              <path d="M20 50 L80 50 M50 20 L50 80" className="ambient-link" />
            </svg>
          )}

          {resolvedPreset === 'orbital' && (
            <svg viewBox="0 0 100 100" className="ambient-svg" preserveAspectRatio="none">
              <ellipse cx="50" cy="50" rx="34" ry="18" className="ambient-line" />
              <ellipse cx="50" cy="50" rx="18" ry="34" className="ambient-line-thin" />
              <circle cx="50" cy="50" r="6" className="ambient-node" />
              <circle cx="84" cy="50" r="3.5" className="ambient-node" />
              <circle cx="50" cy="16" r="3" className="ambient-node" />
            </svg>
          )}

          {resolvedPreset === 'blueprint' && (
            <svg viewBox="0 0 100 100" className="ambient-svg" preserveAspectRatio="none">
              <rect x="14" y="16" width="72" height="68" className="ambient-line-thin" />
              <rect x="24" y="28" width="52" height="44" className="ambient-line" />
              <path d="M14 50 L86 50 M50 16 L50 84" className="ambient-link" />
              <path d="M24 28 L76 72 M76 28 L24 72" className="ambient-link" />
            </svg>
          )}
        </span>
      ))}
    </div>
  );
}
