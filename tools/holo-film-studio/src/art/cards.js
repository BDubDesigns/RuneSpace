/**
 * Silent-film title cards: black card, double-rule border, serif lettering.
 * `card()` returns markup and queues a gentle line-by-line fade/rise.
 */

const SERIF = "'Playfair Display','Bodoni MT',Didot,Georgia,'Times New Roman',serif";

function border(w, h, strong) {
  const o = strong ? 30 : 38;
  const corner = (x, y, sx, sy) =>
    `<g transform="translate(${x} ${y}) scale(${sx} ${sy})"><path d="M0 0 L46 0 M0 0 L0 46" stroke="#f2f2f2" stroke-width="5" fill="none"/><path d="M14 14 L36 14 M14 14 L14 36" stroke="#f2f2f2" stroke-width="2.4" fill="none"/><circle cx="52" cy="0" r="4" fill="#f2f2f2"/><circle cx="0" cy="52" r="4" fill="#f2f2f2"/></g>`;
  return `<rect x="${o}" y="${o}" width="${w - o * 2}" height="${h - o * 2}" fill="none" stroke="#f2f2f2" stroke-width="3"/>
    <rect x="${o + 14}" y="${o + 14}" width="${w - (o + 14) * 2}" height="${h - (o + 14) * 2}" fill="none" stroke="#f2f2f2" stroke-width="1.4"/>
    ${corner(o - 6, o - 6, 1, 1)}${corner(w - o + 6, o - 6, -1, 1)}${corner(o - 6, h - o + 6, 1, -1)}${corner(w - o + 6, h - o + 6, -1, -1)}`;
}

/**
 * @param ctx   scene ctx from defineFilm
 * @param lines [{ t, size?, gap?, style? }] or plain strings
 * @param o     { size, kind: 'plain'|'title'|'studio'|'end', sub }
 */
export function card(ctx, lines, o = {}) {
  const { width: W, height: H, cues, at } = ctx;
  const size = o.size || 76;
  const items = lines.map((l) => (typeof l === 'string' ? { t: l } : l));
  const heights = items.map((l) => (l.size || size) * 1.2);
  const total = heights.reduce((a, b) => a + b, 0);
  let y = H / 2 - total / 2 + (o.dy || 0);
  let g = '';
  items.forEach((l, i) => {
    const s = l.size || size;
    y += heights[i];
    const base = y - s * 0.22;
    const id = `${ctx.id}.line${i}`;
    const t = at(120 + i * 380);
    g += `<g data-t="${id}" style="opacity:0">
      <text x="${W / 2 + 4}" y="${base + 5}" font-size="${s}" text-anchor="middle" fill="#5d5d5d" font-family="${SERIF}" font-weight="900" letter-spacing="${l.spacing ?? 4}">${l.t}</text>
      <text x="${W / 2}" y="${base}" font-size="${s}" text-anchor="middle" fill="#f6f6f6" font-family="${SERIF}" font-weight="900" letter-spacing="${l.spacing ?? 4}">${l.t}</text>
    </g>`;
    cues.push({ at: t, dur: 520, target: id, easing: 'cubic-bezier(.2,.7,.3,1)', keyframes: [{ opacity: 0 }, { opacity: 1 }], reduce: 'snap' });
    cues.push({ at: t, dur: 520, target: id, easing: 'cubic-bezier(.2,.7,.3,1)', keyframes: [{ transform: 'translateY(16px)' }, { transform: 'translateY(0px)' }], reduce: 'skip' });
  });

  let extra = '';
  if (o.kind === 'studio') {
    extra = `<g transform="translate(${W / 2} ${H / 2 - 150})" fill="none" stroke="#f2f2f2" stroke-width="4">
      <circle r="62"/><circle r="50" stroke-width="1.6"/>
      ${[0, 1, 2, 3, 4].map((i) => `<circle cx="${(Math.cos((i / 5) * 6.283 - 1.57) * 28).toFixed(1)}" cy="${(Math.sin((i / 5) * 6.283 - 1.57) * 28).toFixed(1)}" r="11" fill="#f2f2f2" stroke="none"/>`).join('')}
      <circle r="5" fill="#f2f2f2" stroke="none"/>
    </g>`;
  } else if (o.kind === 'title') {
    extra = `<g stroke="#f2f2f2" stroke-width="3" fill="none"><path d="M${W / 2 - 250} ${H - 150} L${W / 2 + 250} ${H - 150}"/><path d="M${W / 2 - 250} ${H - 142} L${W / 2 + 250} ${H - 142}" stroke-width="1.2"/></g>
      <path d="M${W / 2} ${H - 162} l9 12 l-9 12 l-9 -12Z" fill="#f2f2f2"/>`;
    if (o.sub) {
      extra += `<text x="${W / 2}" y="${H - 96}" font-size="26" text-anchor="middle" fill="#cfcfcf" font-family="${SERIF}" font-style="italic" letter-spacing="3">${o.sub}</text>`;
    }
  } else if (o.kind === 'end') {
    extra = `<path d="M${W / 2 - 160} ${H / 2 + 90} L${W / 2 + 160} ${H / 2 + 90}" stroke="#f2f2f2" stroke-width="3"/><path d="M${W / 2} ${H / 2 + 76} l9 14 l-9 14 l-9 -14Z" fill="#f2f2f2"/>`;
  }

  return `<rect width="${W}" height="${H}" fill="#0b0b0b"/>${border(W, H, o.kind === 'title')}${extra}${g}`;
}
