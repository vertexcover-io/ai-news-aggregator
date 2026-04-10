# TypeScript checker `Type.getBaseTypes()` returns undefined for non-interface types

When writing type-aware ESLint rules with `@typescript-eslint/utils` + the TypeScript checker, `Type.getBaseTypes()` is NOT safe to iterate unconditionally. It returns `undefined` for unions, intersections, literals, primitives, and any other non-interface/non-class type. Iterating the result with `for...of` crashes with `TypeError: baseTypes is not iterable`.

Always guard before iterating, and walk the union/intersection's constituent types yourself when present:

```ts
function collectBaseTypes(type: ts.Type, out: ts.Type[]): void {
  if (type.isUnionOrIntersection()) {
    for (const t of type.types) collectBaseTypes(t, out);
    return;
  }
  const bases = type.getBaseTypes();
  if (!bases) return; // <-- required; undefined for literals/primitives
  for (const b of bases) {
    out.push(b);
    collectBaseTypes(b, out);
  }
}
```

Why: In the custom-eslint-plugin run, Phase 6's first RuleTester pass for `collector-return-shape` crashed with `baseTypes is not iterable` the instant a test fixture used a union type in a return annotation. The TS compiler API documents `getBaseTypes()` as returning `BaseType[] | undefined`, but it's easy to forget because TypeScript's own `.d.ts` signature is declared as `BaseType[] | undefined` with the undefined tucked at the end of the union. Any type-aware rule that walks inheritance chains must defensively handle both the `undefined` case AND the union/intersection case, since unions don't have base types in the class-hierarchy sense — you have to recurse into their constituents.