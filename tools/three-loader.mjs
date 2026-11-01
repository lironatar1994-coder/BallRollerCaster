// Node resolve hook: the same bare imports the browser's import map provides.
const vendor = new URL('../vendor/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('three.module.js', vendor).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('addons/' + specifier.slice('three/addons/'.length), vendor).href, shortCircuit: true };
  return next(specifier, context);
}
