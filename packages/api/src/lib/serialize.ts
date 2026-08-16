/**
 * `Date` → ISO string, for anything crossing the wire.
 *
 * The mobile client has no transformer, so a `Date` would arrive as whatever
 * JSON.stringify made of it while the inferred type still claimed `Date`. Every
 * router runs its timestamps through here rather than restating the rule.
 */
export const toIso = (value: Date | null) => value?.toISOString() ?? null;
