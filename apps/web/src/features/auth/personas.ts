import type { LocalPersona } from "@interior-design/contracts";

export interface PersonaOption {
  description: string;
  displayName: string;
  id: LocalPersona;
  roleLabel: string;
}

export const personaOptions: readonly PersonaOption[] = [
  {
    description: "Synthetic tenant Alpha owner",
    displayName: "Alpha homeowner",
    id: "homeowner-alpha",
    roleLabel: "Homeowner",
  },
  {
    description: "Synthetic tenant Beta owner",
    displayName: "Beta homeowner",
    id: "homeowner-beta",
    roleLabel: "Homeowner",
  },
  {
    description: "Synthetic tenant Alpha read-only member",
    displayName: "Alpha viewer",
    id: "viewer-alpha",
    roleLabel: "Viewer",
  },
] as const;
