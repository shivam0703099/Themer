/**
 * Standard Vendetta / Revenge Plugin Build Script (Rollup + esbuild + SWC)
 * Produces dist/<plugin>/index.js and dist/<plugin>/manifest.json (with SHA-256 hash).
 */
import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { createHash } from "crypto";
import { rollup } from "rollup";
import esbuild from "rollup-plugin-esbuild";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";

const plugins = [
  nodeResolve(),
  commonjs(),
  esbuild({
    target: "es2020",
    minify: true,
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
  }),
];

for (const plug of await readdir("./plugins")) {
  const manifestPath = `./plugins/${plug}/manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const outDir = `./dist/${plug}`;
  const outPath = `${outDir}/index.js`;

  await mkdir(outDir, { recursive: true });

  const bundle = await rollup({
    input: `./plugins/${plug}/${manifest.main}`,
    external: (id) => id === "@vendetta" || id.startsWith("@vendetta/"),
    plugins,
  });

  await bundle.write({
    file: outPath,
    format: "iife",
    name: "plugin",
    exports: "named",
    compact: true,
    globals(id) {
      if (id === "@vendetta") return "vendetta";
      if (id.startsWith("@vendetta/")) {
        return id.substring(1).replace(/\//g, ".");
      }
      return id;
    },
  });
  await bundle.close();

  // Wrap so Revenge's evalPlugin returns the exported object cleanly
  const rawCode = await readFile(outPath, "utf8");
  const wrapped = `(function(vendetta){${rawCode};return plugin;})(vendetta)`;
  await writeFile(outPath, wrapped, "utf8");

  const hash = createHash("sha256").update(wrapped).digest("hex");
  const distManifest = {
    ...manifest,
    main: "index.js",
    hash,
  };
  await writeFile(`${outDir}/manifest.json`, JSON.stringify(distManifest, null, 2), "utf8");
  console.log(`Built ${manifest.name} -> ${outDir} (sha256: ${hash.slice(0, 12)}...)`);
}
