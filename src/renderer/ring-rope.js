import { CURSOR_RING_SHAPE } from '../shared/cursor-hole-model.js';

/** The metal support point under the rope force; gravity rests at its true bottom. */
export function charmRopeAttachment(mountAnchor, pet, scale = 1, geometry = null) {
  const centerX = mountAnchor.x + (geometry?.centerFromAnchor.x || 0);
  const centerY = mountAnchor.y + (geometry?.centerFromAnchor.y ?? -CURSOR_RING_SHAPE.centerToAnchor * scale);
  const outer = 1 + CURSOR_RING_SHAPE.wire / CURSOR_RING_SHAPE.radiusX;
  const radiusX = geometry?.radiusX ?? CURSOR_RING_SHAPE.radiusX * outer * scale;
  const radiusY = geometry?.radiusY ?? CURSOR_RING_SHAPE.radiusY * outer * scale;
  const shear = geometry?.shear ?? CURSOR_RING_SHAPE.shear;
  let forceX = pet.x - (centerX + shear * radiusY);
  let forceY = pet.y - (centerY + radiusY);
  if (Math.hypot(forceX, forceY) <= 0.001) { forceX = 0; forceY = 1; }
  // Ellipse support: A(A^T F)/|A^T F|, with A=[[rx,shear*ry],[0,ry]].
  const tx = radiusX * forceX, ty = radiusY * (shear * forceX + forceY);
  const norm = Math.hypot(tx, ty);
  return {
    x: centerX + (radiusX * tx + shear * radiusY * ty) / norm,
    y: centerY + radiusY * ty / norm,
  };
}

/** Visual slack during aim only; physical rope length stays untouched. */
export function ringRopeSag(restLength, attachment, pet) {
  const visibleLength = Math.hypot(pet.x - attachment.x, pet.y - attachment.y);
  const slack = Math.max(0, restLength - visibleLength);
  return Math.min(16, 2 + slack * 0.14);
}
