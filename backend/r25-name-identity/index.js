'use strict';
// Event function handler. HTTP service maps POST request body to event.body.
// No request logging; temporary management credentials stay in the runtime.
const {createHttpHandler}=require('./handler.cjs');
exports.main=createHttpHandler();
