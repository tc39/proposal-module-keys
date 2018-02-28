'use strict';
/* Polyfill */
import {makeFrenemies} from './frenemies.js';
const frenemies = makeFrenemies('index.js');
export let {publicKey} = frenemies;
/* End polyfill */

import {send} from './alice.js';

export let result = send();
