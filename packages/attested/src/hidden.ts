// One definition for both layers. It lived in two files, and that is why widening it
// for the quantity layer left the wording layer open twice running.

/**
 * Characters that render as nothing: format characters, default-ignorable code points
 * and the controls. Cf and Default_Ignorable each hold characters the other does not.
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;

/** The controls that do take room. Deleting these would read `Only 2\n3 left` as 23. */
const SPACING = /[\t\n\v\f\r\u0085]/;

/**
 * Marks that hang on the character before them instead of taking a column of their own,
 * so `4<U+0305>9` reads as 49. Spacing marks (Mc) are not here: a Devanagari matra is
 * a visible gap between two digits and separates them for a reader.
 */
const MARKS = /[\p{Mn}\p{Me}]/gu;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, (char) => (SPACING.test(char) ? char : ''));
}

export function stripMarks(text: string): string {
  return text.replace(MARKS, '');
}
