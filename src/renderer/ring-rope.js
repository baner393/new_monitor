import { CHARM_MOUNT_GEOMETRY } from './charm-mount-geometry.js';

/** The rope touches the visible rim of the cursor ring, facing the pet. */
export function charmRopeAttachment(mountAnchor, pet) {
  const centerX = mountAnchor.x;
  const centerY = mountAnchor.y - (CHARM_MOUNT_GEOMETRY.anchorY - CHARM_MOUNT_GEOMETRY.centerY);
  const dx = pet.x - centerX;
  const dy = pet.y - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1) return { x: mountAnchor.x, y: mountAnchor.y };
  return {
    x: centerX + (dx / distance) * CHARM_MOUNT_GEOMETRY.outerRadius,
    y: centerY + (dy / distance) * CHARM_MOUNT_GEOMETRY.outerRadius,
  };
}

/** Visual slack during aim only; physical rope length stays untouched. */
export function ringRopeSag(restLength, attachment, pet) {
  const visibleLength = Math.hypot(pet.x - attachment.x, pet.y - attachment.y);
  const slack = Math.max(0, restLength - visibleLength);
  return Math.min(16, 2 + slack * 0.14);
}
