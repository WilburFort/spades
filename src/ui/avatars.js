// Parametric inline-SVG avatars so every bot has a face without any image assets.

/**
 * @param {object} spec
 * @param {string} spec.bg  background colour
 * @param {string} spec.skin
 * @param {'bun'|'cap'|'short'|'long'|'bald'|'slick'|'curls'|'bob'} spec.hair
 * @param {string} [spec.hairColor]
 * @param {'round'|'square'|'sun'|null} [spec.glasses]
 * @param {boolean} [spec.beard]
 * @param {boolean} [spec.mustache]
 * @param {boolean} [spec.smile]  default true
 * @param {string} [spec.accent] accessory colour (cap, glasses frame)
 */
export function avatarSvg(spec) {
  const {
    bg = '#5fa8d3', skin = '#f1c9a5', hair = 'short', hairColor = '#3b2a1a', glasses = null,
    beard = false, mustache = false, smile = true, accent = '#e07a3f', earrings = false, initial = '',
  } = spec;
  const parts = [];
  parts.push(`<circle cx="50" cy="50" r="50" fill="${bg}"/>`);
  // shoulders
  parts.push(`<path d="M14 100c4-18 18-28 36-28s32 10 36 28z" fill="${shade(bg, -18)}"/>`);
  // long hair sits behind the head
  if (hair === 'long') parts.push(`<path d="M28 44c0-18 8-30 22-30s22 12 22 30v34H28z" fill="${hairColor}"/>`);
  if (hair === 'bob') parts.push(`<path d="M27 46c0-20 9-32 23-32s23 12 23 32v22c0 6-6 8-10 6H37c-4 2-10 0-10-6z" fill="${hairColor}"/>`);
  // neck + head
  parts.push(`<rect x="43" y="62" width="14" height="14" fill="${shade(skin, -14)}"/>`);
  parts.push(`<ellipse cx="50" cy="48" rx="19" ry="22" fill="${skin}"/>`);
  // ears
  parts.push(`<circle cx="31" cy="50" r="4" fill="${skin}"/><circle cx="69" cy="50" r="4" fill="${skin}"/>`);
  if (earrings) parts.push(`<circle cx="31" cy="55" r="1.8" fill="#ffd166"/><circle cx="69" cy="55" r="1.8" fill="#ffd166"/>`);
  // hair on top
  switch (hair) {
    case 'bun':
      parts.push(`<path d="M31 42c0-12 8-20 19-20s19 8 19 20c-6-6-12-8-19-8s-13 2-19 8z" fill="${hairColor}"/>`);
      parts.push(`<circle cx="50" cy="20" r="9" fill="${hairColor}"/>`);
      break;
    case 'cap':
      parts.push(`<path d="M31 40c0-12 8-20 19-20s19 8 19 20z" fill="${accent}"/>`);
      parts.push(`<path d="M28 40h44c2 0 3 2 3 3s-1 3-3 3H28c-2 0-3-2-3-3s1-3 3-3z" fill="${shade(accent, -20)}"/>`);
      parts.push(`<path d="M69 41c8 0 14 2 16 5-3 1-10 1-16-1z" fill="${shade(accent, -20)}"/>`);
      break;
    case 'short':
      parts.push(`<path d="M31 44c0-14 8-22 19-22s19 8 19 22c-4-8-11-12-19-12s-15 4-19 12z" fill="${hairColor}"/>`);
      break;
    case 'slick':
      parts.push(`<path d="M31 42c0-12 6-20 19-20 12 0 21 6 21 14-8-4-16-4-23-1-6 3-11 7-17 7z" fill="${hairColor}"/>`);
      break;
    case 'curls':
      parts.push(`<path d="M29 46c-3-16 8-28 21-28 14 0 24 12 21 28-3-4-6-6-9-6-3-4-8-6-12-6s-9 2-12 6c-3 0-6 2-9 6z" fill="${hairColor}"/>`);
      for (const [x, y] of [[31, 32], [39, 24], [50, 20], [61, 24], [69, 32]]) parts.push(`<circle cx="${x}" cy="${y}" r="6" fill="${hairColor}"/>`);
      break;
    case 'long':
    case 'bob':
      parts.push(`<path d="M31 42c0-12 8-20 19-20s19 8 19 20c-6-5-12-7-19-7s-13 2-19 7z" fill="${hairColor}"/>`);
      break;
    case 'bald':
    default:
      break;
  }
  // eyes
  parts.push(`<circle cx="43" cy="48" r="2.4" fill="#2b2a26"/><circle cx="57" cy="48" r="2.4" fill="#2b2a26"/>`);
  // brows
  parts.push(`<path d="M39 42c2-2 6-2 8 0M53 42c2-2 6-2 8 0" stroke="${shade(hairColor, 10)}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`);
  // nose
  parts.push(`<path d="M50 50v6c0 1-1 2-2 2" stroke="${shade(skin, -30)}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`);
  // mouth
  if (mustache) parts.push(`<path d="M42 60c3-3 13-3 16 0-3 2-13 2-16 0z" fill="${hairColor}"/>`);
  if (smile) parts.push(`<path d="M43 62c3 4 11 4 14 0" stroke="#7a3b3b" stroke-width="1.8" fill="none" stroke-linecap="round"/>`);
  else parts.push(`<path d="M44 63h12" stroke="#7a3b3b" stroke-width="1.8" fill="none" stroke-linecap="round"/>`);
  if (beard) parts.push(`<path d="M33 54c2 12 8 18 17 18s15-6 17-18c-4 8-10 11-17 11s-13-3-17-11z" fill="${hairColor}" opacity="0.9"/>`);
  // glasses
  if (glasses === 'round') {
    parts.push(`<circle cx="43" cy="48" r="6.5" stroke="${accent}" stroke-width="1.8" fill="none"/><circle cx="57" cy="48" r="6.5" stroke="${accent}" stroke-width="1.8" fill="none"/><path d="M49.5 48h1" stroke="${accent}" stroke-width="1.8"/>`);
  } else if (glasses === 'square') {
    parts.push(`<rect x="36.5" y="42.5" width="12" height="10" rx="2" stroke="${accent}" stroke-width="1.8" fill="none"/><rect x="51.5" y="42.5" width="12" height="10" rx="2" stroke="${accent}" stroke-width="1.8" fill="none"/><path d="M48.5 47h3" stroke="${accent}" stroke-width="1.8"/>`);
  } else if (glasses === 'sun') {
    parts.push(`<rect x="36" y="43" width="12.5" height="9" rx="3" fill="#1b1b1f"/><rect x="51.5" y="43" width="12.5" height="9" rx="3" fill="#1b1b1f"/><path d="M48.5 46h3" stroke="#1b1b1f" stroke-width="2"/>`);
  }
  if (initial) parts.push(`<text x="50" y="94" text-anchor="middle" font-size="11" font-weight="700" fill="rgba(255,255,255,.8)" font-family="system-ui,sans-serif">${initial}</text>`);
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Lighten (+) or darken (-) a hex colour by a percentage. */
function shade(hex, pct) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * (pct > 0 ? 255 - c : c))));
  r = f(r); g = f(g); b = f(b);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** The human player's avatar: a friendly silhouette. */
export function humanAvatarSvg() {
  return avatarSvg({ bg: '#5ad1b5', skin: '#e9b98a', hair: 'short', hairColor: '#2b2a26', smile: true });
}
