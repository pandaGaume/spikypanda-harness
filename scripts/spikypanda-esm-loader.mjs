/**
 * Temporary development loader for the current @spiky-panda/core ESM build.
 * The upstream declarations and JavaScript use extensionless relative imports.
 * Remove this file once core emits explicit .js specifiers.
 */
export async function resolve(specifier, context, nextResolve) {
    try {
        return await nextResolve(specifier, context);
    } catch (originalError) {
        if (!specifier.startsWith(".") || /\.(?:mjs|cjs|js|json|wasm)$/i.test(specifier)) {
            throw originalError;
        }
        for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
            try {
                return await nextResolve(candidate, context);
            } catch {
                // Continue to the next Node-compatible candidate.
            }
        }
        throw originalError;
    }
}
