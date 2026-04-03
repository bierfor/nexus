/** @zero-bundle — Pure SVG progress ring. Zero JS. CSS animated. */
export interface ProgressRingProps {
  value:    number;    // 0–100
  size?:    number;    // px, default 64
  stroke?:  number;    // stroke width, default 6
  color?:   string;    // CSS color, default #6366f1
  label?:   string;    // center text override (default: value%)
}

export function renderProgressRing(props: ProgressRingProps): string {
  const { value, size = 64, stroke = 6, color = '#6366f1', label } = props;
  const clamp = Math.max(0, Math.min(100, value));
  const r      = (size - stroke * 2) / 2;
  const circ   = 2 * Math.PI * r;
  const offset = circ - (clamp / 100) * circ;
  const center = size / 2;

  return `<div class="nx-ring" style="width:${size}px;height:${size}px" role="progressbar" aria-valuenow="${clamp}" aria-valuemin="0" aria-valuemax="100">
  <svg class="nx-ring__svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle class="nx-ring__track" cx="${center}" cy="${center}" r="${r}" stroke-width="${stroke}" />
    <circle class="nx-ring__fill"  cx="${center}" cy="${center}" r="${r}" stroke-width="${stroke}"
      stroke="${color}"
      stroke-dasharray="${circ}"
      stroke-dashoffset="${offset}"
    />
  </svg>
  <span class="nx-ring__label">${label ?? `${clamp}%`}</span>
</div>`;
}
