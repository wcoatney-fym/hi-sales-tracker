const LOWERCASE_PARTICLES = new Set([
  "de", "del", "della", "di", "da", "das", "do", "dos",
  "van", "von", "der", "den", "het",
  "la", "le", "les", "el", "al",
  "bin", "ibn",
]);

function capitalizeWord(word: string): string {
  if (word.length === 0) return word;
  if (word.length === 1) return word.toUpperCase();

  const lower = word.toLowerCase();

  if (lower.startsWith("mc") && word.length > 2) {
    return "Mc" + word.charAt(2).toUpperCase() + lower.slice(3);
  }

  if (lower.startsWith("mac") && word.length > 3 && /^mac[a-z]/.test(lower) && !["mace", "mach", "mack", "macs", "macy"].includes(lower)) {
    return "Mac" + word.charAt(3).toUpperCase() + lower.slice(4);
  }

  if (lower.startsWith("o'") && word.length > 2) {
    return "O'" + word.charAt(2).toUpperCase() + lower.slice(3);
  }

  return word.charAt(0).toUpperCase() + lower.slice(1);
}

function capitalizeHyphenated(segment: string): string {
  return segment
    .split("-")
    .map((part) => capitalizeWord(part))
    .join("-");
}

export function toProperCase(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;

  const words = trimmed.split(" ");

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && LOWERCASE_PARTICLES.has(lower)) {
        return lower;
      }
      return capitalizeHyphenated(word);
    })
    .join(" ");
}

export function isNameMalformatted(name: string): boolean {
  if (!name || !name.trim()) return false;
  const trimmed = name.trim();
  if (trimmed.length <= 1) return false;

  const isAllUpper = trimmed === trimmed.toUpperCase() && /[A-Z]{2,}/.test(trimmed);
  const isAllLower = trimmed === trimmed.toLowerCase() && /[a-z]{2,}/.test(trimmed);

  return isAllUpper || isAllLower;
}
