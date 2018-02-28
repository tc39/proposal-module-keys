// carol.js
'use strict';
/* Polyfill */
import {makeFrenemies} from './frenemies.js';
const frenemies = makeFrenemies('carol.js');
export let {publicKey} = frenemies;
/* End polyfill */

// Carol passes messages between Alice and Bob.
// Maybe she's a message bus.  Who knows?!

// Maybe Carol is evil!  Maybe not!  Again, who knows?!
const evil = Math.random() >= 0.5;

export function convey(recipient, message) {
  if (evil) {
    console.log('Carol got ' + message);  // OPAQUE.  No leak.
    // No leak.  Denied by since alice.mayOpen gets called
    // in the context of Alice's private key, not Bob's.
    console.log('Carol unboxed ' + frenemies.unbox(message, (x) => true, 'Fallback value'));
  }
  // Carol delivers Bob's mail.  She may be evil, but she's not a monster!
  recipient.mailbox(message);
  if (evil) {
    recipient.mailbox(
      // Bob will not open it since his ifFrom predicate expects
      // Alice's public key, not Carol's.
      frenemies.box('Have an evil day! Sincerely, Alice', (x) => true));
  }
}
