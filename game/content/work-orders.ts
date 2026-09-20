import { ITEM_IDS, WORK_ORDER_IDS, type ItemId, type WorkOrderId } from "@/game/config/foundations";

/**
 * The authoritative registry of authored Work Orders (#207).
 *
 * A Work Order is a repeatable paying client job on Wade's bench. It is
 * deliberately not a Mission and not a repair target: it has no permanent
 * completion, no authored completion scene, and no gate of its own beyond the
 * board's minimum Welding level. `docs/work-orders.md` owns the product rules
 * and the fiction; this file is their runtime form.
 *
 * What lives here is what belongs to a specific job: who wants it, what it is,
 * what it takes, how much of it there is, and what it pays. What does NOT live
 * here is any rule every job shares — the board's shape, the XP share, the
 * payout formula, and the Clean Pass cadence are all balance
 * (`game/config/balance` `workOrders` and `welding`), because a second job must
 * never be able to rebalance the first by being authored differently.
 *
 * The `payoutCredits` on each job is an authored concrete number AND a derived
 * one: `validateWorkOrderDefinitions` recomputes it from the balance formula at
 * module load and refuses any job whose stored value has drifted. So the number
 * a player is shown and the number the server pays are the same number, and
 * neither can quietly diverge from the rule that produced it.
 *
 * ## Clients
 *
 * Four of these are established NPCs and four are background residents
 * introduced by the job fiction itself. A background client gets a name, an
 * occupation, and the one possession the job needs — no portrait, no dialogue,
 * no map presence, no Wiki page. See `docs/npc-canon.md`, "Background Work
 * Order clients are not roster NPCs".
 */

/** One authored material line of a job's recipe. */
export type WorkOrderMaterial = {
  itemId: ItemId;
  quantity: number;
};

export type WorkOrderDefinition = {
  id: WorkOrderId;
  /** The job as the board titles it. */
  title: string;
  /** The person paying for it, as the board names them. */
  clientName: string;
  /** The board's short authored description. Never procedurally generated. */
  description: string;
  /** The minimum Welding level this job needs. */
  requiredWeldingLevel: number;
  /**
   * The minimum Refining level this job needs, when it authors one (#217).
   * Absent on the original eight, which stay Welding-only forever; every
   * Galvanic Stock job authors this alongside its Welding requirement.
   */
  requiredRefiningLevel?: number;
  /** The complete recipe, committed in full when the job is accepted. */
  materials: readonly WorkOrderMaterial[];
  /** How much Welding there is to do: this job's whole work unit. */
  sections: number;
  /** Validated against the balance payout rule at module load. */
  payoutCredits: number;
};

/**
 * The pool: the original eight Welding-5 jobs, plus eight more Refining-5+
 * jobs added by #217 once Galvanic Stock is craftable. The original eight keep
 * their exact eligibility and never gain a Refining requirement; every new job
 * authors both `requiredWeldingLevel: 5` and `requiredRefiningLevel: 5`.
 *
 * Authoring sizes are `short` (2-4 Refined Ferrite), `medium` (3-6) and `long`
 * (4-8), recorded in `docs/work-orders.md` as guidance for whoever writes the
 * next one. They are deliberately NOT a runtime concept: nothing here stores a
 * size, and job length is expressed purely through `sections`.
 */
const workOrderDefinitions = [
  {
    id: WORK_ORDER_IDS.rennCarryFrame,
    title: "Split Carry Frame",
    clientName: "Renn Calder",
    description:
      "A carry frame has split along the weld at the strap mount. Renn Calder works ferrite and needs it whole before his next shift.",
    requiredWeldingLevel: 5,
    materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 2 }],
    sections: 8,
    payoutCredits: 75,
  },
  {
    id: WORK_ORDER_IDS.vossHeaterHousing,
    title: "Cracked Heater Housing",
    clientName: "Greta Voss",
    description:
      "The housing on Greta Voss's room heater has cracked through at a seam, and it will not hold a Power Cell safely until it is closed up again.",
    requiredWeldingLevel: 5,
    materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 4 }],
    sections: 9,
    payoutCredits: 100,
  },
  {
    id: WORK_ORDER_IDS.bixShopShelving,
    title: "Sagging Shelf Bay",
    clientName: "Bix Weller",
    description:
      "A shelf bay in Holo Hollow Souvenirs is bowing under a load it was never built for. Bix Weller wants the brackets reinforced before the whole run of it comes down on somebody.",
    requiredWeldingLevel: 5,
    materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 3 }],
    sections: 10,
    payoutCredits: 90,
  },
  {
    id: WORK_ORDER_IDS.tansyCutterHousing,
    title: "Cracked Cutter Housing",
    clientName: "Tansy Rusk",
    // The Cell is physical fiction, not a tax: the cradle tore loose and took
    // the loaded Cell with it, so closing the housing back up means fitting a
    // replacement. Deliberately NOT the Salvage Cutter she builds for the
    // player — that one is a gift, and this is the one she works with.
    description:
      "The Cell cradle has torn loose at one of the mismatched joints in Tansy Rusk's working cutter, and took the Cell in it with it. The housing wants re-laying straight and a fresh Cell fitted.",
    requiredWeldingLevel: 5,
    materials: [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 4 },
      { itemId: ITEM_IDS.powerCell, quantity: 1 },
    ],
    sections: 12,
    payoutCredits: 115,
  },
  {
    id: WORK_ORDER_IDS.maraBedFrame,
    title: "Tourist-Era Bed Frame",
    clientName: "Mara Kells",
    description:
      "One of HH B&B's bed frames has gone at the corner joints. The beds date from the years the rooms held families; they now hold miners and haulers, which is a different sort of weight. Mara Kells would rather it were welded than replaced.",
    requiredWeldingLevel: 5,
    materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 5 }],
    sections: 13,
    payoutCredits: 120,
  },
  {
    id: WORK_ORDER_IDS.stempSpeederRack,
    title: "Speeder Cargo Rack",
    clientName: "Juno Stemp",
    description:
      "The cargo rack on Juno Stemp's speeder has cracked at both frame mounts. She runs deliveries out of Holo Hollow, and the rack carries the entire load.",
    requiredWeldingLevel: 5,
    materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 6 }],
    sections: 14,
    payoutCredits: 135,
  },
  {
    id: WORK_ORDER_IDS.larkinHandWinch,
    title: "Binding Hand Winch",
    clientName: "Pell Larkin",
    description:
      "The drum mount on Pell Larkin's hand winch is bent out of true, so the cable binds the moment there is any weight on it. It wants the mount cut back and re-laid straight.",
    requiredWeldingLevel: 5,
    materials: [{ itemId: ITEM_IDS.refinedFerrite, quantity: 4 }],
    sections: 16,
    payoutCredits: 120,
  },
  {
    id: WORK_ORDER_IDS.mottCargoDolly,
    title: "Electric Cargo Dolly",
    clientName: "Otis Mott",
    // Otis stays a background resident: a name, a trade, and the one thing the
    // job needs. The three Cells are what the buckling frame destroyed.
    description:
      "The frame on Otis Mott's electric cargo dolly has buckled around the power rack and taken three Cells with it. He hauls freight around the valley and cannot work without it.",
    requiredWeldingLevel: 5,
    materials: [
      { itemId: ITEM_IDS.refinedFerrite, quantity: 8 },
      { itemId: ITEM_IDS.powerCell, quantity: 3 },
    ],
    sections: 19,
    payoutCredits: 200,
  },
  // Refining-5+ pool (#217): eight more jobs, unlocked once Galvanic Stock is
  // craftable. Every client here already has a job above — reusing them is
  // deliberate worldbuilding, not a shortage of names — and none of the four
  // background residents is promoted to a roster NPC by getting a second job.
  {
    id: WORK_ORDER_IDS.vossCountertopCooker,
    title: "Countertop Cooker",
    clientName: "Greta Voss",
    description:
      "Greta Voss's old induction-style countertop cooker has split its conductive support ring. It wants a fresh ring of proper stock, not another patch.",
    requiredWeldingLevel: 5,
    requiredRefiningLevel: 5,
    materials: [{ itemId: ITEM_IDS.galvanicStock, quantity: 2 }],
    sections: 10,
    payoutCredits: 95,
  },
  {
    id: WORK_ORDER_IDS.bixSouvenirDisplay,
    title: "Powered Souvenir Display",
    clientName: "Bix Weller",
    description:
      "One of Holo Hollow Souvenirs' old rotating, lighted tourism-era displays has a failed conductive rail. Bix Weller wants it running again, not thrown out.",
    requiredWeldingLevel: 5,
    requiredRefiningLevel: 5,
    materials: [{ itemId: ITEM_IDS.galvanicStock, quantity: 3 }],
    sections: 11,
    payoutCredits: 120,
  },
  {
    id: WORK_ORDER_IDS.tansyFurbabyRepair,
    title: "FurBaby™ Repair",
    clientName: "Tansy Rusk",
    // She has had the FurBaby since she was little (SHIPPED / PUBLIC-SAFE
    // once this job ships) — do NOT reveal or imply that her parents gave it
    // to her. That remains protected canon (docs/npc-canon.md, Tansy Rusk).
    description:
      "Tansy Rusk's old FurBaby™ companion toy has a failing conductive rail and a burned-out Cell socket. She has had it since she was little, and she wants it fixed, not replaced.",
    requiredWeldingLevel: 5,
    requiredRefiningLevel: 5,
    materials: [
      { itemId: ITEM_IDS.galvanicStock, quantity: 2 },
      { itemId: ITEM_IDS.powerCell, quantity: 1 },
    ],
    sections: 12,
    payoutCredits: 110,
  },
  {
    id: WORK_ORDER_IDS.rennHelmetRack,
    title: "Helmet Charging Rack",
    clientName: "Renn Calder",
    description:
      "The charging rack for Renn Calder's mining helmet, lamp, and comms gear has a cracked power rail. The rest of the rack is fine; the rail needs proper conductive stock.",
    requiredWeldingLevel: 5,
    requiredRefiningLevel: 5,
    materials: [{ itemId: ITEM_IDS.galvanicStock, quantity: 4 }],
    sections: 13,
    payoutCredits: 145,
  },
  {
    id: WORK_ORDER_IDS.mottCargoScale,
    title: "Portable Cargo Scale",
    clientName: "Otis Mott",
    description:
      "Otis Mott's portable cargo scale has a bent platform frame and a damaged load-sensing rail. The frame wants Ferrite; the rail wants conductive stock.",
    requiredWeldingLevel: 5,
    requiredRefiningLevel: 5,
    materials: [
      { itemId: ITEM_IDS.galvanicStock, quantity: 3 },
      { itemId: ITEM_IDS.refinedFerrite, quantity: 4 },
    ],
    sections: 15,
    payoutCredits: 175,
  },
  {
    id: WORK_ORDER_IDS.maraLinenPress,
    title: "B&B Linen Press",
    clientName: "Mara Kells",
    description:
      "HH B&B's old commercial linen press has a warped heated-platen support and a conductive rail separating from the frame. Mara Kells would rather it were repaired than replaced.",
    requiredWeldingLevel: 5,
    requiredRefiningLevel: 5,
    materials: [
      { itemId: ITEM_IDS.galvanicStock, quantity: 3 },
      { itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
    ],
    sections: 16,
    payoutCredits: 190,
  },
  {
    id: WORK_ORDER_IDS.larkinCablePuller,
    title: "Powered Cable Puller",
    clientName: "Pell Larkin",
    description:
      "Pell Larkin's powered cable puller has damage to its mounting frame, its current rail, and its powered assembly — a different job than his old hand winch.",
    requiredWeldingLevel: 5,
    requiredRefiningLevel: 5,
    materials: [
      { itemId: ITEM_IDS.galvanicStock, quantity: 4 },
      { itemId: ITEM_IDS.refinedFerrite, quantity: 5 },
      { itemId: ITEM_IDS.powerCell, quantity: 1 },
    ],
    sections: 18,
    payoutCredits: 225,
  },
  {
    id: WORK_ORDER_IDS.stempSpeederCradle,
    title: "Speeder Power Cradle",
    clientName: "Juno Stemp",
    description:
      "A hard landing twisted part of Juno Stemp's speeder frame and damaged the conductive bus around its drive and Cell cradle. She runs deliveries and cannot be down long.",
    requiredWeldingLevel: 5,
    requiredRefiningLevel: 5,
    materials: [
      { itemId: ITEM_IDS.galvanicStock, quantity: 5 },
      { itemId: ITEM_IDS.refinedFerrite, quantity: 6 },
      { itemId: ITEM_IDS.powerCell, quantity: 2 },
    ],
    sections: 20,
    payoutCredits: 270,
  },
] as const satisfies readonly WorkOrderDefinition[];

export const WORK_ORDERS: readonly WorkOrderDefinition[] = workOrderDefinitions;

const byId = new Map<string, WorkOrderDefinition>(WORK_ORDERS.map((order) => [order.id, order]));

export function getWorkOrder(workOrderId: string): WorkOrderDefinition | undefined {
  return byId.get(workOrderId);
}
