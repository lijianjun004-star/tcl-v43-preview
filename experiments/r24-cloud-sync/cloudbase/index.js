// Standard CloudBase Event function entry. The HTTP gateway supplies the event.
exports.main = async (event) => (await import('./function.mjs')).main(event);
