export interface SeedGraphFreezerPort {
  /**
   * Fase 2 (fuera de inTransaction): congela thr-seed-01-gate1 y thr-seed-02-gate2
   * tras el COMMIT de Fase 1.
   */
  freezeDemoGates(): Promise<void>;
}
