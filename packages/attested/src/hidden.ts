const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;

const SPACING = /[\t\n\v\f\r\u0085]/;

const MARKS = /[\p{Mn}\p{Me}]/gu;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, (char) => (SPACING.test(char) ? char : ''));
}

export function stripMarks(text: string): string {
  return text.replace(MARKS, '');
}
