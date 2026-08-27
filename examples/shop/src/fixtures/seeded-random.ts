/**
 * A small deterministic generator (mulberry32).
 *
 * `Math.random()` cannot be seeded, and a fixture that changes between runs
 * turns every failure into a question about the fixture. This is not a source
 * of randomness for anything that matters — it exists so a catalog is a
 * function of its seed.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4_294_967_296;
  };
}
