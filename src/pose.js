import * as THREE from "three";

export function createFishOrientation() {
  const up = new THREE.Vector3(0, 1, 0);
  const verticalReference = new THREE.Vector3(0, 0, 1);
  const side = new THREE.Vector3();
  const upright = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  return (direction, quaternion) => {
    side.crossVectors(direction, Math.abs(direction.y) > 0.99 ? verticalReference : up).normalize();
    upright.crossVectors(side, direction).normalize();
    basis.makeBasis(direction, upright, side);
    quaternion.setFromRotationMatrix(basis);
  };
}
