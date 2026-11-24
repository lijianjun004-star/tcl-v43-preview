// Standard CloudBase Event function entry. The HTTP gateway supplies the event.
exports.main = async (event, context) => (await import('./function.mjs')).main(event, context);
