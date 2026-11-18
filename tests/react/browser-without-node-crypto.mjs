/* oxlint-disable no-underscore-dangle */
import Module, { register } from 'node:module';
import { NODE_CRYPTO } from './block-node-crypto.mjs';

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (NODE_CRYPTO.test(request)) throw new Error(`the react entry imported ${request}`);
  return resolveFilename.call(this, request, ...rest);
};
register('./block-node-crypto.mjs', import.meta.url);

const react = await import('@rudra-js/react');
console.log(typeof react.RudraComponent);
