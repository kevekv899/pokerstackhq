/**
 * The table ids the cash pages join.
 *
 * The server derives a room's rules from its id (`variantForTableId`), so the
 * id a page joins *is* the variant it will be dealt. That makes these ids part
 * of each page's contract rather than a cosmetic default: join an id the server
 * reads as Hold'em from the Omaha page and it deals two hole cards to a felt
 * drawn for four, silently. They live here so both pages and the tests that
 * hold them to it read the same values.
 */

import { variantForTableId, type GameVariant } from "@/lib/poker/types";

export const HOLDEM_TABLE_NUMBER = 4821;
export const OMAHA_TABLE_NUMBER = 4822;

export const HOLDEM_TABLE_ID = `holdem-${HOLDEM_TABLE_NUMBER}`;
export const OMAHA_TABLE_ID = `omaha-${OMAHA_TABLE_NUMBER}`;

/**
 * The id a page rendering `variant` should join, honouring a `?table=`
 * override only when the server would resolve it to the same variant.
 *
 * An override for the other variant is dropped rather than passed on: it is a
 * URL, so anyone can type one, and a page cannot render rules it was not built
 * for. The page's own table is the fallback.
 */
export function tableIdFor(variant: GameVariant, requested: string | null): string {
  const own = variant === "OMAHA" ? OMAHA_TABLE_ID : HOLDEM_TABLE_ID;
  if (!requested) return own;
  return variantForTableId(requested) === variant ? requested : own;
}
