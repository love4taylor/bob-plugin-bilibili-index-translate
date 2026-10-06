import inventory from "../data/languages.json";

// Model training-language inventory intersected with Bob's documented codes.
export const languageNames: Record<string, string> = Object.fromEntries(
  Object.entries(inventory.bobLanguages).map(([code, language]) => [code, language.name]),
);
