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

  // Cherry band (optional fourth photo). PROTOTYPE colour-and-defect heuristic, not a trained model. DRAFT values.
  cherry: {
    fruitMinFraction: 0.05,     // cherry-coloured share of the photo below this = no cherry seen, no grade
    // White card: near-neutral and bright. Paper in phone photos measured saturation up to 0.15 and value from 0.56;
    // two real photos of cherries on the tree reach a "card" share of 0.08-0.10 by these rules, so 0.25 refuses them.
    cardMinFraction: 0.25,      // white-card share of the photo below this = not on the card, no grade
    cardSatMax: 0.2,
    cardValMin: 0.55,
    satMin: 0.3,                // below this a pixel is card or background, not fruit
    darkValMax: 0.22,           // fruit darker than this counts as a defect (overripe, dried, black)
    ripeHueMin: 335,            // ripe red wraps around 0 degrees: hue >= 335 or <= 12
    ripeHueMax: 12,
    unripeHueMin: 45,           // yellow-green through green counts as a defect (unripe)
    unripeHueMax: 170,
    bandA: { ripeMin: 0.8, defectMax: 0.08 },
    bandB: { ripeMin: 0.6, defectMax: 0.2 },   // anything else that has enough fruit is band C
  },

  // Buyer tickets shown next to the band: the last N cooperative tickets of that band, as a range.
  harvest: { ticketCount: 3 },

  sms: { maxChars: 160 },
};
