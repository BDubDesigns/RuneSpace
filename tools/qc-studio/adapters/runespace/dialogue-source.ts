import ts from "typescript";

/**
 * Read-only locator for `game/content/dialogue.ts` (#185).
 *
 * This is deliberately not a rewriting framework: it parses the file with the
 * TypeScript compiler the repository already depends on, only to find exact
 * source spans (the authoritative sequence, its `beats` array, each element,
 * and the beat-helper functions). Every edit is a plain text splice made by
 * `dialogue-apply.ts`. Anything this module cannot classify precisely is
 * reported as `opaque`, and the apply step refuses to touch it.
 */

/** The authoritative constant registries dialogue source refers to by name, e.g. `NPC_IDS`. */
export type ConstantMaps = Readonly<Record<string, Readonly<Record<string, string>>>>;

export type BeatValue = string | number;

/**
 * A top-level `function xLocal(expressionId, text): DialogueBeat` that returns
 * one object literal. Derived from the source itself so a newly authored helper
 * is supported without a parallel table to keep in sync.
 */
export type BeatHelper = {
  name: string;
  kind: "npc" | "item" | "skill_xp";
  /** Beat fields the helper fixes (speaker, background, presentation mode, ...). */
  fixed: Readonly<Record<string, BeatValue>>;
  /** Call parameters in order, each naming the beat field it fills. */
  params: readonly { name: string; field: string; defaultValue?: BeatValue }[];
};

export type SourceElement =
  | {
      kind: "helper-call";
      node: ts.Expression;
      call: ts.CallExpression;
      helper: BeatHelper;
      /** Every argument is a literal or a registry reference, never computed. */
      isStatic: boolean;
    }
  | { kind: "opaque"; node: ts.Expression; reason: string };

export type DialogueSourceIndex = {
  sourceFile: ts.SourceFile;
  sourceText: string;
  constants: ConstantMaps;
  helpers: readonly BeatHelper[];
  /** Top-level `const crash = CONVERSATION_BACKGROUND_IDS.x` aliases: identifier → value. */
  aliases: ReadonlyMap<string, string>;
};

export type SequenceLocation = {
  /** The whole `[DIALOGUE_IDS.x]: { ... }` property. */
  property: ts.PropertyAssignment;
  beatsArray: ts.ArrayLiteralExpression;
  elements: readonly SourceElement[];
};

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isBeatValue(value: unknown): value is BeatValue {
  return typeof value === "string" || typeof value === "number";
}

/** Resolves a literal, registry reference (`NPC_IDS.wadeRusk`), or known alias; never evaluates code. */
export function resolveStatic(
  expression: ts.Expression,
  constants: ConstantMaps,
  aliases: ReadonlyMap<string, string>,
): BeatValue | undefined {
  const node = unwrap(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const map = Object.hasOwn(constants, node.expression.text)
      ? constants[node.expression.text]
      : undefined;
    return map && Object.hasOwn(map, node.name.text) ? map[node.name.text] : undefined;
  }
  if (ts.isIdentifier(node)) return aliases.get(node.text);
  return undefined;
}

function collectAliases(sourceFile: ts.SourceFile, constants: ConstantMaps) {
  const aliases = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = resolveStatic(declaration.initializer, constants, aliases);
      if (typeof value === "string") aliases.set(declaration.name.text, value);
    }
  }
  return aliases;
}

function deriveHelper(
  fn: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  constants: ConstantMaps,
  aliases: ReadonlyMap<string, string>,
): BeatHelper | undefined {
  if (!fn.name || !fn.body || fn.type?.getText(sourceFile) !== "DialogueBeat") return undefined;
  const [statement, ...rest] = fn.body.statements;
  if (rest.length > 0 || !statement || !ts.isReturnStatement(statement) || !statement.expression) {
    return undefined;
  }
  const returned = unwrap(statement.expression);
  if (!ts.isObjectLiteralExpression(returned)) return undefined;

  const params: { name: string; field: string; defaultValue?: BeatValue }[] = [];
  const paramNames = new Map<string, { defaultValue?: BeatValue }>();
  for (const parameter of fn.parameters) {
    if (!ts.isIdentifier(parameter.name)) return undefined;
    let defaultValue: BeatValue | undefined;
    if (parameter.initializer) {
      defaultValue = resolveStatic(parameter.initializer, constants, aliases);
      if (defaultValue === undefined) return undefined;
    }
    paramNames.set(parameter.name.text, defaultValue === undefined ? {} : { defaultValue });
  }

  const fixed: Record<string, BeatValue> = {};
  const fieldByParam = new Map<string, string>();
  for (const property of returned.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      if (!paramNames.has(property.name.text)) return undefined;
      fieldByParam.set(property.name.text, property.name.text);
      continue;
    }
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return undefined;
    const initializer = unwrap(property.initializer);
    if (ts.isIdentifier(initializer) && paramNames.has(initializer.text)) {
      fieldByParam.set(initializer.text, property.name.text);
      continue;
    }
    const value = resolveStatic(initializer, constants, aliases);
    if (value === undefined) return undefined;
    fixed[property.name.text] = value;
  }

  for (const parameter of fn.parameters) {
    const name = (parameter.name as ts.Identifier).text;
    const field = fieldByParam.get(name);
    if (!field) return undefined;
    const meta = paramNames.get(name);
    params.push({
      name,
      field,
      ...(meta?.defaultValue !== undefined ? { defaultValue: meta.defaultValue } : {}),
    });
  }

  const kind = fixed.kind;
  if (kind !== "npc" && kind !== "item" && kind !== "skill_xp") return undefined;
  const fixedFields: Record<string, BeatValue> = { ...fixed };
  delete fixedFields.kind;
  return { name: fn.name.text, kind, fixed: fixedFields, params };
}

export function indexDialogueSource(
  sourceText: string,
  fileName: string,
  constants: ConstantMaps,
): DialogueSourceIndex {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const aliases = collectAliases(sourceFile, constants);
  const helpers: BeatHelper[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement)) continue;
    const helper = deriveHelper(statement, sourceFile, constants, aliases);
    if (helper) helpers.push(helper);
  }
  return { sourceFile, sourceText, constants, helpers, aliases };
}

/** The beat a helper call produces, or undefined when any argument is computed. */
export function evaluateHelperCall(
  element: Extract<SourceElement, { kind: "helper-call" }>,
  index: DialogueSourceIndex,
): Record<string, BeatValue> | undefined {
  const { helper, call } = element;
  const beat: Record<string, BeatValue> = { kind: helper.kind, ...helper.fixed };
  for (const [position, param] of helper.params.entries()) {
    const argument = call.arguments[position];
    const value = argument
      ? resolveStatic(argument, index.constants, index.aliases)
      : param.defaultValue;
    if (!isBeatValue(value)) return undefined;
    beat[param.field] = value;
  }
  return beat;
}

function classifyElement(node: ts.Expression, index: DialogueSourceIndex): SourceElement {
  if (ts.isSpreadElement(node)) {
    return { kind: "opaque", node, reason: "a spread of computed beats" };
  }
  const inner = unwrap(node);
  if (ts.isObjectLiteralExpression(inner)) {
    return { kind: "opaque", node, reason: "an inline object literal" };
  }
  if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)) {
    const name = inner.expression.text;
    const helper = index.helpers.find((candidate) => candidate.name === name);
    if (!helper)
      return { kind: "opaque", node, reason: `a call to \`${name}\`, not a beat helper` };
    if (
      inner.arguments.length > helper.params.length ||
      inner.arguments.some((argument) => ts.isSpreadElement(argument))
    ) {
      return {
        kind: "opaque",
        node,
        reason: `a \`${name}\` call with an unexpected argument list`,
      };
    }
    const isStatic = inner.arguments.every(
      (argument) => resolveStatic(argument, index.constants, index.aliases) !== undefined,
    );
    return { kind: "helper-call", node, call: inner, helper, isStatic };
  }
  return { kind: "opaque", node, reason: "an expression that is not a beat-helper call" };
}

/**
 * Finds the one `[DIALOGUE_IDS.key]: { ... }` entry of `const dialogue = {...}`
 * whose registry value is `sequenceId`. Returns an error string rather than
 * guessing when the source is not shaped exactly that way.
 */
export function locateSequence(
  index: DialogueSourceIndex,
  sequenceId: string,
): SequenceLocation | string {
  let catalog: ts.ObjectLiteralExpression | undefined;
  for (const statement of index.sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "dialogue" &&
        declaration.initializer
      ) {
        const initializer = unwrap(declaration.initializer);
        if (ts.isObjectLiteralExpression(initializer)) catalog = initializer;
      }
    }
  }
  if (!catalog) return "the source has no `const dialogue = { ... }` catalog";

  const matches = catalog.properties.filter((property): property is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(property) || !ts.isComputedPropertyName(property.name)) {
      return false;
    }
    return resolveStatic(property.name.expression, index.constants, index.aliases) === sequenceId;
  });
  if (matches.length !== 1) {
    return `expected exactly one \`[DIALOGUE_IDS.*]\` entry for "${sequenceId}" in the source, found ${matches.length}`;
  }
  const [property] = matches as [ts.PropertyAssignment];

  const body = unwrap(property.initializer);
  if (!ts.isObjectLiteralExpression(body)) return "the sequence entry is not an object literal";
  const beatsProperty = body.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === "beats",
  );
  if (!beatsProperty) return "the sequence entry has no `beats` property";
  const beatsArray = unwrap(beatsProperty.initializer);
  if (!ts.isArrayLiteralExpression(beatsArray)) {
    return "the sequence `beats` is not an inline array literal";
  }
  return {
    property,
    beatsArray,
    elements: beatsArray.elements.map((element) => classifyElement(element, index)),
  };
}
