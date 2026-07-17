import { createGrayscalePng, createSvgPlan } from "./bytes.js";
import { createPlanFixture, rectangularTruth } from "./factory.js";

export const developmentPlanFixtures = Object.freeze([
  createPlanFixture({
    bytes: createSvgPlan(
      '<path d="M50 50 H550 V400 H50 Z" fill="none" stroke="#000" stroke-width="8"/><text x="70" y="90">DEVELOPMENT SPLIT</text>',
    ),
    category: "golden",
    description: "Development-only single-room vector plan with one closed rectangular boundary.",
    expected: { disposition: "proposal" },
    id: "c6-dev-vector-rectangle",
    mimeType: "image/svg+xml",
    sequence: 1,
    split: "train",
    title: "Development vector rectangle",
    truth: rectangularTruth(1),
  }),
  createPlanFixture({
    bytes: createGrayscalePng(97, 73, [
      { from: [8, 8], to: [88, 8] },
      { from: [88, 8], to: [88, 64] },
      { from: [88, 64], to: [8, 64] },
      { from: [8, 64], to: [8, 8] },
    ]),
    category: "golden",
    description: "Validation-only grayscale raster rectangle with no metadata or real address.",
    expected: { disposition: "proposal" },
    id: "c6-validation-raster-rectangle",
    mimeType: "image/png",
    sequence: 2,
    split: "validation",
    title: "Validation raster rectangle",
    truth: rectangularTruth(2, 10),
  }),
]);
