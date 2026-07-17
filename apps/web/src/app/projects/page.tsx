import type { Metadata } from "next";

import { ProjectsScreen } from "../../features/projects/projects-screen";

export const metadata: Metadata = {
  title: "Projects",
};

export default function ProjectsPage() {
  return <ProjectsScreen />;
}
