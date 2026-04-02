export const DONUT_SIZE = 160;
export const DONUT_CX = DONUT_SIZE / 2;
export const DONUT_CY = DONUT_SIZE / 2;
export const DONUT_R = DONUT_SIZE / 2;
export const DONUT_INNER_R = Math.round(DONUT_R * 0.42);

export function donutPolarToCart(angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: DONUT_CX + DONUT_R * Math.cos(rad),
    y: DONUT_CY + DONUT_R * Math.sin(rad),
  };
}

export function donutArcPath(startDeg: number, endDeg: number): string {
  if (Math.abs(endDeg - startDeg) >= 359.9) {
    return `M ${DONUT_CX} ${DONUT_CY - DONUT_R} A ${DONUT_R} ${DONUT_R} 0 1 1 ${DONUT_CX - 0.01} ${DONUT_CY - DONUT_R} Z`;
  }
  const s = donutPolarToCart(startDeg);
  const e = donutPolarToCart(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${DONUT_CX} ${DONUT_CY} L ${s.x} ${s.y} A ${DONUT_R} ${DONUT_R} 0 ${large} 1 ${e.x} ${e.y} Z`;
}
