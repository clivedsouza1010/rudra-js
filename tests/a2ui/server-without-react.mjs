/* oxlint-disable no-underscore-dangle */
import Module, { register } from 'node:module';
import { REACT } from './block-react.mjs';

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (REACT.test(request)) throw new Error(`the server entry imported ${request}`);
  return resolveFilename.call(this, request, ...rest);
};
register('./block-react.mjs', import.meta.url);

const server = await import('@rudra-js/a2ui/server');
console.log(typeof server.buildRecommendationMessages);
