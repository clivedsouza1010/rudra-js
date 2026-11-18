export const NODE_CRYPTO = /^(node:)?crypto$/;

export async function resolve(specifier, context, next) {
  if (NODE_CRYPTO.test(specifier)) throw new Error(`the react entry imported ${specifier}`);
  return next(specifier, context);
}
