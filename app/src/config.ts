// All thresholds and tunables in one place. Values marked DRAFT are heuristics, not validated agronomy.

export const STRESS_CLASSES = ["healthy", "miner", "rust", "phoma", "cercospora"] as const;
export type StressClass = (typeof STRESS_CLASSES)[number];

export const CONFIG = {
  // Quality gate (per photo, before inference). Tuned on BRACOL test images: see ml/tune_quality.py.
  quality: {
    analysisWidth: 256,         // photo is downscaled to this width for the checks
    blurMinLaplacianVar: 60,    // variance of Laplacian on grey (0-255), leaf region at 256 px wide; below = blurry
    lumaMin: 60,                // mean luminance (0-255) band
    lumaMax: 235,
    clippedMaxFraction: 0.5,    // fraction of pixels at <=5 or >=250
    leafMinFraction: 0.08,      // leaf-coloured fraction in the centre region
    centreFraction: 0.6,        // centre region = middle 60% x 60%
    // leaf colour in HSV (h in degrees, s/v in 0-1): green through yellow-brown
    leafHueMin: 15,
    leafHueMax: 170,
    leafSatMin: 0.18,
    leafValMin: 0.12,
    cropMarginFraction: 0.02,   // margin around the leaf bounding box before inference
  },

  // Three-leaf aggregation and refusal.
  aggregate: {
    minGoodPhotos: 2,
    minAgreeingLeaves: 2,
    highConfidence: 0.9,        // "high" label on the card; between tau and this = "medium"
  },

  // Trend.
  trend: { windowDays: 42 },

  // Severity band for action lookup: low = levels 1-2, high = levels 3-4.
  severityHighMin: 3,

  // F4 cause ranking. DRAFT heuristics.
  causes: {
    maxScored: 3,
    contextStaleDays: 30,
    disease: { base: 0.5, perSeverity: 0.1, worseBonus: 0.2, weatherBonus: 0.15 },
    diseaseWeather: { tempMinC: 18, tempMaxC: 26, rhMinPct: 75, weatherStresses: ["rust", "phoma"] as StressClass[] },
    drySpell: { ratio: 0.6, strongRatio: 0.4, score: 0.5, strongScore: 0.8 },
    soilAcidity: { phMax: 5.0, strongPhMax: 4.5, score: 0.4, strongScore: 0.6 },
    sprayedRecently: { score: 0.45 },
  },

  sms: { maxChars: 160 },
};
