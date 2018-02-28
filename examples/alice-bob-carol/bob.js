// bob.js
'use strict';
/* Polyfill */
import {makeFrenemies} from './frenemies.js';
const frenemies = makeFrenemies('bob.js');
export let {publicKey} = frenemies;
/* End polyfill */

// Bob gets a message from Alice and verifies that it comes from her.
import * as alice from './alice.js';

function ifFrom(sender) {
  return sender === alice.publicKey && sender();
}

// Carol puts messages in mailboxes.
export function mailbox(box) {
  const value = frenemies.unbox(
    box, ifFrom, 'a message of questionable provenance!');
  console.log(`Bob read: ${value}`);
}
