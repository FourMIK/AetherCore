/**
 * Materia Module Exports
 * Hardware-rooted sensor and GUI module system
 */

export { MateriaSlot } from "./MateriaSlot";
export type { MateriaSlotConfig, MateriaSlotProps } from "./MateriaSlot";

export { ISRSlot } from "./ISRSlot";
export type { ISRSlotConfig, ISRSlotProps } from "./ISRSlot";

export { BioSlot } from "./BioSlot";
export type { BioSlotConfig, BioSlotProps, BioMetrics } from "./BioSlot";

export { LedgerSlot } from "./LedgerSlot";
export type {
  LedgerSlotConfig,
  LedgerSlotProps,
  MerkleVineLinkData,
} from "./LedgerSlot";

export { IdentitySlot } from "./IdentitySlot";
export type {
  IdentitySlotConfig,
  IdentitySlotProps,
  CodeRalphieCredential,
} from "./IdentitySlot";
