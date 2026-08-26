/** `SM` — the two-letter stand-in when a member has no avatar image. */
export const formatMemberInitials = (displayName: string): string => {
  const [first, second] = displayName.trim().split(/\s+/).filter(Boolean);
  if (!first) return "?";

  // `charAt` returns "" rather than undefined past the end, so a one-word,
  // one-letter name simply yields a single initial.
  return (
    first.charAt(0) + (second?.charAt(0) ?? first.charAt(1))
  ).toUpperCase();
};
