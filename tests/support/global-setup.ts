import type { TestProject } from "vitest/node";
import {
  buildArtifacts,
  removeArtifacts,
  type Artifacts,
} from "./artifacts.ts";

declare module "vitest" {
  export interface ProvidedContext {
    f1Artifacts: Artifacts;
  }
}

export default function setup(project: TestProject): () => void {
  const artifacts = buildArtifacts();
  project.provide("f1Artifacts", artifacts);
  return () => {
    removeArtifacts(artifacts);
  };
}
