# TC39 Module Keys (Stage 1 Proposal)

Lets project teams trust code they know with more than code they don't.

This proposal adds per-module APIs visible within a *ModuleBody*
that enable secure communication channels between modules to enable
a large application to grant different degrees of trust to different modules.

[Quick link to code](https://github.com/mikesamuel/tc39-module-keys/blob/master/examples/alice-bob-carol/frenemies.js).

[Slides for May TC39 meeting](https://docs.google.com/presentation/d/1VJsrZjW5vVpi9xnWP6EY2LI5XmpPxEmEcB0jqKQdvhs)

[Implementation and polyfilling babel plugin on NPM](https://www.npmjs.com/package/module-keys)

It is based on a [proof of concept in Node.js `require()`d modules][CommonJS proof of concept].
It is largely a rewrite of the [Node frenemies design][] into an ES6 modules context.

- [Background](#background)
- [Goal](#goal)
- [Non-goals](#non-goals)
- [API Sketch](#api-sketch)
- [Use Case Summary](#use-case-summary)
- [Solution: Node module loader acts as trusted intermediary to enable mutual suspicion](#solution-node-module-loader-acts-as-trusted-intermediary-to-enable-mutual-suspicion)
  * [Reliable Channel Example](#reliable-channel-example)
  * [Example Code](#example-code)
- [Use Case Solution Sketches](#use-case-solution-sketches)
  * [Contract Values](#contract-values)
  * [Opaque Values](#opaque-values)
  * [Reifying Permissions](#reifying-permissions)
  * [Access Restrictions](#access-restrictions)
- [Alternate approaches](#alternate-approaches)
  * [We're all adults here.](#were-all-adults-here)
  * [Unit testing](#unit-testing)
  * [Turn off unneeded functionality](#turn-off-unneeded-functionality)
  * [Examine all third-party dependencies](#examine-all-third-party-dependencies)
  * [Write your own instead of using third-party code](#write-your-own-instead-of-using-third-party-code)
  * [Load modules in separate contexts](#load-modules-in-separate-contexts)
- [Implications for code rewriters.](#implications-for-code-rewriters)
- [Module loader hooks](#module-loader-hooks)
- [Failure modes](#failure-modes)

## Background

Large EcmaScript projects are collaborations between different authors:

*  First-party authors who understand the project's goals and security needs.
*  Direct dependency authors -- those that have been
   explicitly `import`ed by first-party authors and are familiar with
   the security needs of the kinds of projects that need them.
*  Deep dependencies authored by people trying to solve a general
   problem with little insight into any particular project's specific
   security needs.
   A dependency is "deep" when you have to go through multiple layers
   of `import`s to find out why it is loaded.

## Goal

Allow a project's authors to grant more authority to modules they
are familiar with while still granting some authority to deep
dependencies.

We want to make sure the path of least resistance for a deep
dependency is to degrade gracefully when granted less authority
instead of working around security measures to provide a higher
quality of service but at a higher level of risk.

## Non-goals

It is not a goal to allow one to safely load malicious third-party code.
Even code written in good faith can put a project at risk if parts are
written carelessly or if its authors define "secure" differently from
the first-party authors.

We assume that all module authors are acting in good faith but that
first-party and third-party authors still end up working at cross purposes
and that first-party authors are better placed to represent end-users'
interests.

## API Sketch

We use the name `frenemies` below.  This is a terrible name.  If this
advances to stage 3, we expect to bikeshed a better name.

Per *ModuleBody*, we make available a frozen API:

*  `frenemies.publicKey()`: a function that returns `true` when there is a private key on the call stack and the shallowest
private key on the call stack corresponds to this key, or false otherwise.
*  `frenemies.privateKey(f)`: a function that calls f and returns its result.  See call stack relationship for `.publicKey`.
*  `frenemies.box(value, mayOpen)`: returns a unique `Box` instance.
*  `frenemies.unbox(box, ifFrom, fallback)`: awaits `box`.
    Let *value* and *mayOpen* be the arguments provided when `box`
    was created and *boxer* be the *Frenemies* instance used
    to create the box.  The call to `unbox` returns *value* if
    `mayOpen(frenemies.publicKey)` is true when called
    in the context of `frenemies.privateKey`, **and**
    `ifFrom(`*boxer*`.publicKey)` is true when called
    in the context of *boxer*`.privateKey`.
    Otherwise, returns `fallback`.

Before execution of the module body starts, we
`export frenemies.publicKey as publicKey`.
Like default exports `publicKey` does not participate in re-exporting;
it is included in `*` for the purposes of `export * from ...`.

Per realm, we make available:

*  a `makeFrenemies` function that produces a unique `frenemies` instance.
   This would help source code rewriters preserve module semantics.  See below.
*  a `class Box { toString() { return '[Box]' } }`.
*  an `isPublicKey(x)` function that returns true only for public keys
   produced by `makeFrenemies`.  This makes it easier to write solid
   `mayOpen` and `ifFrom` predicates.

<!--

A new export declaration

*BeforeImportCheck* :: `export` `if` *PrimaryExpression* `;`

All the expressions here are public key predicates that are intersected thus:
`(...predicates) => (key) => predicates.every(p => p(key))`

which would affect *CreateImportBinding* by adding these steps:

1. Let *beforeCheck* = the before import checks for *M*
2. Assert: *beforeCheck* is undefined or a function
3. Let *privateKey* = *envRec*`.frenemies.privateKey`
4. Let *publicKey* = *envRec*`.frenemies.publicKey`
5. Assert: *privateKey*(() => *beforeCheck*(*publicKey*))

-->

## Use Case Summary

These use cases are discussed in more detail later when we relate
them to the propsed solution.

Most of the use cases revolve around treating modules known to align
with the project's security goals differently from the mass of
deep dependencies whose behavior we want to bound.

*  Server-side, use JS engine hooks to restrict use of `new Function` to 
   intentional uses in carefully reviewed modules.
*  Prevent or warn on powerful APIs (those that send messages, invoke shells)
   by unwhitelisted modules.
*  Restrict use of unsafe or error-prone APIs that require specific
   expertise and care to use correctly.  Error messages could
   steer users at wrapping APIs that are suitable for general use.

This can also enable safe-by-construction guarantees:

*  Allow some modules to mint values that pass a verifier so that
   any module can verify they are safe-by-construction regardless
   of what other modules they pass through.  This is especially useful
   for *contract values* that encapsulate a security property.
   E.g. [trusted types][] benefit from being able to
   limit the ability to create values that pass a verifier to those
   that have been reviewed by domain experts.

Opaque values make it easier to keep sensitive data private:

*  Allow a layer that extracts sensitive inputs to ferry them to their
   destination without having to worry about intermediate modules.
   For example, code for a reset password or credit card processing
   form might want to ensure that neither shows up in log.  Being able
   to wrap a value lets us guarantee that the sensitive input is not
   going to show up in logs or error traces.
*  Similarly for [PII][] like physical locations from client-side Geo APIs.


## Solution: Node module loader acts as trusted intermediary to enable mutual suspicion

We can realize these use cases if we have a way for one module to
open a reliable channel to another.

### Reliable Channel Example

Two modules `alice.js` and `bob.js` wish to collaborate in a tightly
coupled manner (be less suspicious of requests from one another) while
checking inputs from other modules more carefully.  They may wish to
use `carol.js` to carry messages, but do not wish to grant read access
to `carol.js`.

One way to allow this would be for Alice to create a box containing
the value she wishes to communicate that only Bob can open
(confidentiality), and provide Bob a way to know that the box came
from Alice (authenticity).

We could do this via asymmetric crypto if all we wanted to pass were
strings and Alice and Bob had a way to exchange keys, but JavaScript
objects that close over local variables do not serialize well.

<span id="ror"></span>

The *[random oracle][]* model explains cryptographic primitives
in terms of a stable mapping from inputs to unpredictable strings.
JavaScript does not allow forging object references
(e.g. casting `int`s to pointers) or extracting object references
from a closure's local scope.
These two properties, the uniqueness and privacy of `new Object`s,
let us get the benefits of crypto-style operators for JavaScript
objects without serializing by replacing that model with a
*distinct object reference oracle* model.

In *[frenemies.js][]* we implement a pure-JavaScript analogue of
secure channels that can convey arbitrary values providing
[*Confidentiality* and *Authenticity*][CIA triad plus] and
building on top of a JavaScript analogue of private/public key pairs.

It does not provide *Integrity* or *Non-Repudiation*.  If the boxed
value is available via other means, it might be modified between being
boxed and being unboxed.  For this reason, although a boxer can't
repudiate the identity of the boxed value, they could repudiate the
value (or absence) of any property reachable via properties that were
not frozen/sealed when the object was boxed.  To get non-repudiation,
we would need to provide an unbox operator that additionally checks
that the object was deeply-frozen and sealed before boxing completed.

*Availability* doesn't have a clear meaning in this context.  There
is no guarantee that Carol, in the example above, will deliver Alice's
box to Bob; an out of memory error, stack overflow, or OS interrupt
could prevent any step in the process.

A **private key** is a per-module function that takes a function.
It calls its argument in such a way that a call to the corresponding
public key will return its first argument instead of its second.

A **public key** is a per-module function that returns its first
argument (defaults to true) when called in the context of the
corresponding private key, or its second argument (default to false)
otherwise.

### Example Code

```js
// alice.js
'use strict';
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
```

```js
// bob.js
'use strict';
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
```

```js
// carol.js
'use strict';
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
```

## Use Case Solution Sketches
Here we sketch out how we address the use cases above.

### Contract Values
Project members may trust some modules to produce HTML:

*  `widely-used-html-sanitizer.js` which filters HTML tags and attributes
*  `autoescaping-template-engine.js` which plugs untrusted values into a
   trusted HTML template

based on their extensive experience with these modules,
but not others:

*  `mysterious-markdown-converter.js` which shows up in the project's
   dependencies for reasons no one has investigated.

Luckily all these modules produce [`TrustedHtml`][trusted types]
values which takes a box containing the string of HTML.

When it's time to flush a chunk of HTML to an HTTP response buffer,
the request handler unboxes the `TrustedHTML` content if it comes from
one of the first two.  If it comes from another source it treats it
with more suspicion, perhaps passing it back to the sanitizer which
unboxes it without regards to its source and whitelists tags and
attributes.

The template engine is also a consumer -- when rendering it
gets the project policy to decide when to inline a chunk of
trusted HTML without escaping.

Other project teams might trust `widely-used-html-sanitizer.js`
with their own policy, but don't trust third-party code to
craft their own policies, so only whitelist a wrapped version
of `widely-used-html-sanitizer.js`.

This proposal provides `publicKey`s per module which provides a
basis for defining whitelists, and a mechanism for consumers of
values to check whitelists.

Boxes are tamper-proof in transit, so don't require reorganizing
the way data flows through a system as long as the intermediate
layers don't insist on coercing values to strings.

Library code can define common key predicates:

```js
/**
 * A public key predicate that checks whether a key
 * is allowed.
 */
export function makeWhitelist(...allowed) {
  const idSet = new Set(allowed)
  return (publicKey) => (
      frenemies.isPublicKey(publicKey) &&
      publicKey() &&
      // TODO: avoid depending on Set.prototype
      idSet.has(publicKey))
}
```

and a configuration could create whitelists:

```js
import {publicKey as fooKey} from 'foo';
import {publicKey as barKey} from 'bar';
import {makeWhitelist} from '/whitelists.js';

const myWhitelist = Object.freeze(makeWhitelist([fooKey, barKey]);
```


### Opaque Values
We may trust our framework code to route inputs to the right place
when everything is ok, but there's too much code that looks like

```js
function execute(...args) {
  try {
    // ...
  } catch (exc) {
    log('Execution failed given %o: %o', args, exc);
    // ...
  }
}
```

`dataBundle` may contain sensitive information:

*  Real names
*  Unsalted passwords
*  Geo locations
*  Credit cards

We need to encourage developers to build systems that they can
debug in the field, but we still need to keep sensitive data out
of logs that might not be as resistant to attack as our key stores.

Reliably opaque values can help us balance these two needs.

As soon as request handler extracts sensitive data, it can box it
and specify which modules can open it using the same kind of module
whitelist as above.

Opaque values don't require mutual suspicions, so reasonably reliable
opaque values could be had by other means.


### Reifying Permissions
[*What about `eval`*](https://nodesecroadmap.fyi/chapter-2/what-about-eval.html)
explains that quirks of JavaScript make it easier to unintentionally
convert a string to code than in other languages, and
[*Dynamically bounding `eval`*](https://nodesecroadmap.fyi/chapter-2/bounded-eval.html)
proposes a way to allow some uses of `eval` without the blanket ban
implied by [`--disallow_code_generation_from_strings`][].

We can represent permissions as boxes, and the permission checker
can unbox it with an `ifFrom` parameter that only accepts the permission
granter.

To request permissions, the requestor would create a box and give it
to the grantor which could use the whitelist scheme above.

These permissions would be delegatable with the usual caveats.

Permissions can also be revocable.

```js
// Granter
const whitelist = (see ^ above);
function mayI(request) {
  let permission () => false
  let revoke = () => {}
  if (frenemies.unbox(request, whitelist, false)) {
    let youMay = true;
    permission = () => youMay
    revoke = () => { youMay = false }
  }
  return {
    permission: frenemies.box(permission, () => true),
    revoke
  }
}


// Requester
import * as granter from '/granter.js';
const { permission, revoke } = granter.mayI(frenemies.box(true, () => true));
// Do something that invokes checker with permission


// Checker
import * as granter from '/granter.js';
function check(permission) {
  if (frenemies.unbox(
          permission, (k) => k === granter.publicKey && k(), () => false)()) {
    // Grant
  } else {
    // Deny
  }
}
```


### Access Restrictions
Some modules are inherently sensitive.  For example, in a Node.js
context:

*  `fs` -- file system access
*  `child_process` -- shell access
*  `net` -- network sends
*  user-libraries that wrap the same

Client-side, future sensitive APIs might be exposed as builtin modules.

These are incredibly powerful, and most large projects use one or all
of these to great effect.

They or their counterparts in other languages are also involved in
many large-scale exploits.

Most third-party modules do not require all of these.

It would be nice for a project team to be able to bound which code
should use those, review that code, and then enforce that going
forward.  Then if a new dependency needs access, it should fail
loudly so that they can incrementally review the new use.

It would also be nice if tricky use of reflective operators, like
that which exploits the `Function` constructor for which we advocated
permissions, failed safely.

We have shown above that this proposal provides a basis for whitelists
of modules which lets us define the boundary of what has been reviewed.

We could enforce this with extra syntax if we could rely on sensitive
modules to opt-in `export if (importerPublicKey => ...);`.

[Resolve hooks][resolve hooks] would allow vetoing arbitrary imports
based on a check that takes into account the "parent" and "child" modules
as identified by their keys.

## Alternate approaches

Here are alternate approaches that have been suggested to granting
different authority to different code.

### We're all adults here.

Most JavaScript projects takes a "we're all adults here" attitude
to development.
None of is going to do something stupid like `undefined = 1337`,
so we can all get along without worrying about corner cases that
only occur when `undefined === 1337`.

This argument is raised in two different ways:

*  We're all adults so we can provide third-party library authors
   with all the authority they *could* need and trust them to manage
   risk on their clients' behalf.
*  We're all adults so, if we do need to implement a security policy
   in code, we can use half-measures since adults don't try to work
   around security policies.

This attitude is great in moderation, but we're not all adults --
we're a large collection of adults who can't possibly all talk to
each other because that's an O(n&#xb2;) problem.

Large groups don't have the common context that "we're all adults here"
implies.

There are several kinds of *context* that affect the security of an end
product.

*  Deep dependency authors don't understand the specific security
   needs of that end product.
*  Deep dependency authors are often domain experts in the problem their
   library solves, but often are not experts in how an attacker can
   turn powerful features they may use can be turned against the end
   product.
*  End product developers do not understand how the deep dependency
   author solves the problem.

If a third-party developer has a choice between using a powerful feature
to definitely solve a problem for one client who is requesting it and
maybe keeping risk low for other clients who are not present requesting
they don't, they will likely do so.  Ones who consistently don't will
not gain users.

It is unreasonable to expect third-party developers to approximate
[POLA][] for a specific end product.

We need to enable a small group of security specialists to guarantee
security properties while third-party developers focus on bringing
their strengths to bear.

Re whether we can trust adults not to work around half-measures,
in goals above we wanted to

> make sure the path of least resistance for a deep dependency is to
> degrade gracefully

A library author wants to provide a high level of service.
If they can by peeking inside a box and don't clearly see how this
increases the risk to an end product, then they are likely to peek.
If they can't peek inside, the path of least resistance is to degrade
gracefully.

We're all adults here; sometimes adults with deadlines and not enough
coffee.  Strong fences make good neighbours, let security specialists
manage product's security, and guide third-party developers towards
graceful degradation and away from hacks that work around policies.


### Unit testing

Why not write unit test that your code doesn't do things with
untrusted inputs that it shouldn't?

Unit test suites can give confidence that a system does what it
*should*, but do a poor job checking that it doesn't do what
it *shouldn't*.  Mechanisms that limit or contain the damage
that code can do when exposed to malicious inputs can help
large development teams maintain velocity while giving
confidence in the latter.

### Turn off unneeded functionality

This is mostly raised in the context of Node.js but has also
been raised in terms of [`Feature-Policy`][feature-policy].

We talk about powerful modules like `fs` and `sh` and powerful
operators like `eval` and note that few modules need one of these
but that most projects do.  If this were not the case, then
shell injection and leaks of sensitive files would not be as
frequent as they are.

Project teams benefit from having them when they need them if
we can limit the downside.

### Examine all third-party dependencies

Some argue that developers should not depend on any code that
they haven't read, or that they wouldn't be happy writing.

Developers do use code that they haven't read.

We don't advocate reading all your dependencies because
that sounds super boring and would probably become your
full-time job.

### Write your own instead of using third-party code

This may be a fine approach for something project-critical
where you have domain expertise on the project team, but
doesn't scale.

If a large project tried this, they would have to become
large enough that internally and would have enough pressure
to provide reusable components, they would recreate the
first-party/third-party disconnect.

### Load modules in separate contexts

Some have proposed loading each module in its own realm,
with its own version of globals.

It may be a fine idea, but probably breaks modules that
assume `Object.prototype` and other builtins are identical
across modules.

It also does not, by itself, address these use cases,
though might, if there were a way to prevent some modules
from `require`-ing specific others.

It could be complementary with this proposal.

## Implications for code rewriters.

Code rewriters that merge or bundle modules, will have to change to accommodate this
proposal by manufacturing a public/private key pair for modules that mention `frenemies`.

Even if `frenemies` is not mentioned, rewriters also adds an implicit export of a public key.
If a module never mentions `frenemies`, then it never uses its private key, so attaching a
well-known public key that whose corresponding private key has been discarded should suffice.
This well-known public key would be equivalent to `(a, b = false) => b` but would pass the
`isPublicKey` predicate.
Code rewriters that eliminate dead code should be able to eliminate this vestige in many cases.

## Module loader hooks

We assume module loader hooks are trusted so do not defend against module hooks that collect
private keys.  Any "security considerations" section in published guidelines for loader hook
authors should mention that loader hook authors are responsible for not leaking private keys.

## Failure modes

Implicit in "grant ... to module" is the idea that a module is a principal.
This brings along the usual risks when authorizing based on principals:

**Impersonation** - one module masquerading as another.
For example, the `vm` module uses the `filename` option to load code
in a way that makes it obvious in stack traces where code originated.
Modules that use stack introspection
(e.g. [node-sec-patterns](https://www.npmjs.com/package/node-sec-patterns))
to authenticate a caller may mistakenly authorize code run in a context
created with `{ filename: './high-authority-module.js' }`.

Another way a module might try to prove its identity to a sensitive
function that it calls is to pass in a value that only it knows.  This
is susceptible to replay attacks -- once passed, the receiver knows the
value, and can save the value so that it can later use the privileges
of the caller.

The attached code should not be susceptible to impersonation as long
as a module does not leak its `privateKey`, `box`, or `unbox` functions.

If a module identity were based on a string name, then loading the same
module in a separate realm (e.g. via `<iframe>`) might allow bypasses.
All mutable state in this proposal is per realm, so this proposal should
not suffer this vector. 

**Attacking the policy** - For server-side code, if we store grant
decisions in a configuration file like `package.json`, a lower privileged module
could (temporarily or not) edit that file to grants itself more
privileges.

**Attack of the clones** - For server-side code, a lower privileged module
could prepend script it wishes to run to the main file of a more highly
privileged module.

We do not attempt to solve these last two problems.  Existing techniques
like denying the node runtime write access to source and configuration
files and doing resource integrity checks on load should suffice.

**Attacking objects** - For server-side code, Node.js does not run JS.
C++ addons may be
able to violate the assumptions that underlie our [random oracle replacement](#ror).
Programmatic access to out-of-band debuggers ([1][debugger] [2][vm.debug]), and
[deserialize APIs][] have also allowed object forgery in similar systems.

We do not attempt to solve these problems either.  "If you can't trust
native code who can you trust" is not an ideal security posture, but
project teams should already be careful about which C++ addons they load
in production, and a feature like this might allow bounding access to
out-of-band APIs (like debug hooks and deserialization APIs) which would
be a better security situation than having no such bounds.  (Debug APIs 
should probably be turned off in production.)

<!-- Also I could have put a ! in the wrong place.
     It wouldn't be the first time. -->

[trusted types]: https://github.com/WICG/trusted-types
[PII]: https://en.wikipedia.org/wiki/Personally_identifiable_information
[CIA triad plus]: https://www.owasp.org/index.php/Guide_to_Cryptography#Authentication
[random oracle]: https://en.wikipedia.org/wiki/Random_oracle
[debugger]: https://nodejs.org/api/debugger.html
[vm.debug]: https://nodejs.org/api/vm.html#vm_vm_runindebugcontext_code
[deserialize APIs]: https://nodejs.org/api/v8.html#v8_v8_deserialize_buffer
[`--disallow_code_generation_from_strings`]: https://github.com/nodejs/node/pull/18212/files
[js-membranes]: https://tvcutsem.github.io/js-membranes
[frenemies.js]: https://github.com/mikesamuel/tc39-module-keys/blob/master/examples/alice-bob-carol/frenemies.js
[POLA]: https://en.wikipedia.org/wiki/Principle_of_least_privilege#History
[Node frenemies design]: https://gist.github.com/mikesamuel/bd653e9f69595f7b9d7dd4381a154e02
[CommonJS proof of concept]: https://github.com/nodejs/node/pull/19017
[feature-policy]: https://wicg.github.io/feature-policy/
