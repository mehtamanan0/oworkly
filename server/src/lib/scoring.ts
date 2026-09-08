// Deterministic, rule-based scoring policy — mirrors AssessmentScoringPolicy from
// `03_NET_API_Architecture.md` §2 and the pass/fail rule in
// `01_Architecture_Overview.md` §9.4: outcome decisions are never an AI call.

export type ComponentType = "theory" | "practical" | "behaviour";

export interface ScoreComponentInput {
  componentType: ComponentType;
  rawScore: number;
  maxPossibleScore: number;
  forcedFail?: boolean; // a failed critical practical safety item, per 02_Database_Schema.sql practical_checklist_item.is_critical
}

export interface WeightageConfig {
  theoryWeightPct: number;
  practicalWeightPct: number;
  behaviourWeightPct: number;
  passingScorePct: number;
}

export interface CompositeResult {
  compositeScorePct: number;
  weightedPctByComponent: Record<ComponentType, number>;
  rawPctByComponent: Record<ComponentType, number>;
  forcedFail: boolean;
  result: "PASS" | "FAIL";
}

const weightKeyFor: Record<ComponentType, keyof WeightageConfig> = {
  theory: "theoryWeightPct",
  practical: "practicalWeightPct",
  behaviour: "behaviourWeightPct",
};

export function computeComposite(
  components: ScoreComponentInput[],
  weightage: WeightageConfig
): CompositeResult {
  const weightedPctByComponent = {} as Record<ComponentType, number>;
  const rawPctByComponent = {} as Record<ComponentType, number>;
  let forcedFail = false;

  for (const c of components) {
    const rawPct = c.maxPossibleScore > 0 ? (c.rawScore / c.maxPossibleScore) * 100 : 0;
    const weightPct = Number(weightage[weightKeyFor[c.componentType]]);
    rawPctByComponent[c.componentType] = round2(rawPct);
    weightedPctByComponent[c.componentType] = round2((rawPct / 100) * weightPct);
    if (c.forcedFail) forcedFail = true;
  }

  const compositeScorePct = round2(
    Object.values(weightedPctByComponent).reduce((sum, v) => sum + v, 0)
  );
  const result = !forcedFail && compositeScorePct >= Number(weightage.passingScorePct) ? "PASS" : "FAIL";

  return { compositeScorePct, weightedPctByComponent, rawPctByComponent, forcedFail, result };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
