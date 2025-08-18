import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import path from "path";
import { promises as fs } from "fs";
import { renderJavaScriptVisitor } from "@codama/renderers";

/**
 * Loads the Anchor IDL JSON file from the default aggregator project location.
 * @returns The parsed Anchor IDL object.
 *
 * The path is resolved relative to the project root: ./aggregator
 */
const loadAnchorIdl = async (): Promise<any> => {
  // __dirname points to the directory of this script, which is ./aggregator
  const idlPath = path.join("target", "idl", "aggregator.json");
  try {
    const idlContent = await fs.readFile(idlPath, "utf-8");
    return JSON.parse(idlContent);
  } catch (error) {
    console.error(`Failed to load Anchor IDL from ${idlPath}:`, error);
    throw error;
  }
};

// Wrap all top-level await logic in an async IIFE to comply with ES2020 module restrictions
(async () => {
  const idl = await loadAnchorIdl();

  const codama = createFromRoot(rootNodeFromAnchor(idl));

  // Output path is also relative to ./aggregator
  const generatedPath = path.join("clients", "generated", "aggregator");
  codama.accept(renderJavaScriptVisitor(generatedPath));
  console.log(
    `✅ Successfully generated JavaScript client for directory: ${generatedPath}`
  );
})();
