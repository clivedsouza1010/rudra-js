export const REACT = /^(react|react-dom|@a2ui\/react|@rudra-js\/react)(\/|$)/;

export async function resolve(specifier, context, next) {
  if (REACT.test(specifier)) throw new Error(`the server entry imported ${specifier}`);
  return next(specifier, context);
}
