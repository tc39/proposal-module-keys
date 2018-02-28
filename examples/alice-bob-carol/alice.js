// alice.js
'use strict';
/* Polyfill */
import {makeFrenemies} from './frenemies.js';
const frenemies = makeFrenemies('alice.js');
export let {publicKey} = frenemies;
/* End polyfill */

// Alice sends a message to Bob.

import * as bob from './bob.js';
import * as carol from './carol.js';

const mayOpen = (opener) => opener === bob.publicKey && opener();

export function send () {
  const messageForBob = frenemies.box(
    'Have a nice day, Bob! Sincerely, Alice',
    mayOpen);

  console.group('Alice is sending');
  carol.convey(bob, messageForBob);
  console.groupEnd();
}
