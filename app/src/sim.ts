// Simulation mode (?sim=1): the app runs inside the simulation page of the cooperative server, which plays the
// farmer's steps with bundled sample leaves. It uses its own database, never the real one on this phone,
// and marks every report it sends as synthetic.
const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;

export const SIM = !!q?.has("sim");

/** The server the simulation page runs on (it passes its own address). */
export const SIM_SERVER = (() => {
  const s = q?.get("server") ?? "";
  return /^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(s) ? s.replace(/\/$/, "") : null;
})();

export const SIM_PLOT = "OND-0017";
