'use strict';
// SCF Event handler: provider-probe-entry.main. Keep .js wrapper because Node's
// extension-less require resolution does not automatically resolve a .cjs file.
exports.main=require('./readonly-probe.cjs').main;
