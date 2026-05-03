import { jsPDF } from "jspdf";

export default function ExportPDF({ data }) {
  const handleExport = () => {
    const doc  = new jsPDF({ unit: "mm", format: "a4" });
    const W    = 210;
    const M    = 22;          // left margin
    const CW   = W - M * 2;  // content width
    const RM   = W - M;      // right margin x
    let y      = 0;

    // ── constants ───────────────────────────────────────────────────
    const LH      = 5.5;   // body line height
    const LH_SM   = 5.0;   // small text line height
    const GAP_SM  = 3;
    const GAP_MD  = 6;
    const GAP_LG  = 10;

    // ── colour helpers ──────────────────────────────────────────────
    const rgb = (hex) => [
      parseInt(hex.slice(1,3),16),
      parseInt(hex.slice(3,5),16),
      parseInt(hex.slice(5,7),16),
    ];
    const tc  = (hex) => doc.setTextColor(...rgb(hex));
    const dc  = (hex) => doc.setDrawColor(...rgb(hex));
    const fc  = (hex) => doc.setFillColor(...rgb(hex));

    // ── typography primitives ───────────────────────────────────────
    // All text goes through these — no inline font-switching

    /** Render a block of wrapped body text. Returns next y. */
    const body = (text, yp, opts = {}) => {
      const { color = "#374151", size = 9, indent = 0, bold = false } = opts;
      tc(color);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, CW - indent);
      doc.text(lines, M + indent, yp);
      return yp + lines.length * LH;
    };

    /** Section heading with rule underneath. Returns next y. */
    const heading = (text, yp) => {
      tc("#0f172a");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text(text, M, yp);
      dc("#cbd5e1");
      doc.setLineWidth(0.25);
      doc.line(M, yp + 2.5, RM, yp + 2.5);
      return yp + 9;
    };

    /** Sub-heading (bold label on its own line, then indented value). */
    const entry = (label, value, yp) => {
      let ny = body(label, yp, { bold: true, color: "#1e293b" });
      ny = body(value, ny, { indent: 4, color: "#374151" });
      return ny + 2;
    };

    /** Fixed two-column row: label left, value right-aligned. */
    const kv = (label, value, yp, opts = {}) => {
      const { labelColor = "#6b7280", valueColor = "#1e293b" } = opts;
      tc(labelColor);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(label, M + 2, yp);
      tc(valueColor);
      doc.setFont("helvetica", "bold");
      doc.text(value, RM, yp, { align: "right" });
      return yp + LH;
    };

    /** Horizontal rule. */
    const rule = (yp, color = "#e2e8f0") => {
      dc(color);
      doc.setLineWidth(0.2);
      doc.line(M, yp, RM, yp);
      return yp;
    };

    /** Add new page, reset y. */
    const page = () => { doc.addPage(); return 20; };

    /** Guard: start new page if less than `needed` mm remaining. */
    const guard = (needed, yp) =>
      yp + needed > 277 ? page() : yp;

    // ── data ────────────────────────────────────────────────────────
    const damage   = data.damage   || {};
    const ml       = data.ml       || {};
    const psd      = data.psd      || {};
    const byRoad   = damage.by_road_class || {};
    const clf      = ml.classifier || {};
    const reg      = ml.regressor  || {};
    const clust    = ml.clustering || {};
    const trans    = Object.values(psd.transmissibility || {})[0] || {};
    const rms      = Object.values(psd.rms_summary     || {})[0] || {};
    const profiles = clust.cluster_profiles || [];
    const topFeats = (clf.top_features || []).slice(0, 5);

    const cobR   = byRoad.cobblestone?.damage_relative_to_asphalt;
    const dirtR  = byRoad.dirt?.damage_relative_to_asphalt;
    const clfAcc = clf.accuracy         ? `${(clf.accuracy * 100).toFixed(1)}%` : "N/A";
    const clfCV  = clf.cv_accuracy_mean
      ? `${(clf.cv_accuracy_mean * 100).toFixed(1)}% +/- ${(clf.cv_accuracy_std * 100).toFixed(1)}%`
      : "N/A";
    const r2Str  = reg.r2_score != null ? reg.r2_score.toFixed(4) : "N/A";

    // ── PAGE 1 ──────────────────────────────────────────────────────

    // Title bar
    fc("#0f172a"); doc.rect(0, 0, W, 38, "F");

    tc("#ffffff");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Fatigue Load Characterisation & Usage Profiling Study", M, 15);

    tc("#94a3b8");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("Passive Vehicular Sensor (PVS) Dataset  |  1 vehicle  |  100 Hz  |  24 min  |  Below-suspension IMU", M, 24);
    doc.text(
      `${new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })}  |  Analysis: Rainflow / Miner's Rule / Random Forest / XGBoost / K-Means`,
      M, 31
    );

    y = 48;

    // ── 1. Key Findings ─────────────────────────────────────────────
    y = heading("1.  KEY FINDINGS", y);

    y = body(
      "Four findings from this study have direct implications for durability target development:",
      y
    );
    y += GAP_SM;

    y = body(
      "1.  Cobblestone road accumulates 10.1x more fatigue damage per unit time than asphalt, " +
      "and dirt road 5.8x. The difference is driven by cycle amplitude (peak range 114 vs 61 m/s2), " +
      "not cycle count. With m=3 in Miner's Rule, a cycle twice as large does 8x the damage. " +
      "Components designed to an asphalt-only load envelope are under-specified by a factor of 10 " +
      "for customers who regularly drive on cobblestone.",
      y, { indent: 4 }
    );
    y += GAP_SM;

    y = body(
      "2.  The suspension attenuates 86% of road input at 10 Hz and 88% at 20 Hz, with a " +
      "resonant peak at 2.0 Hz. Below-suspension components experience 6.17 m/s2 RMS; " +
      "the body sees 2.08 m/s2 RMS. Separate load specifications are required for sub-frame / " +
      "wheel-end components vs. above-suspension body components.",
      y, { indent: 4 }
    );
    y += GAP_SM;

    y = body(
      "3.  A Random Forest classifier identifies road surface type from IMU signals alone " +
      `(no GPS, no camera) with ${clfAcc} accuracy (${clfCV} CV). The primary discriminating ` +
      "signal is gyroscope Z rotation rate, not vertical acceleration. This enables road surface " +
      "classification from CAN-accessible accelerometer data in fleet deployments.",
      y, { indent: 4 }
    );
    y += GAP_SM;

    y = body(
      "4.  K-Means clustering (k=4) identifies an off-road usage archetype (1,269 windows, " +
      "mean RMS 8.23 m/s2, dominant road cobblestone) that accumulates approximately 11x " +
      "more fatigue damage per unit time than the mixed-use asphalt cluster. This archetype " +
      "should define the P99 worst-case design target.",
      y, { indent: 4 }
    );
    y += GAP_LG;

    // ── 2. Fatigue Damage Analysis ───────────────────────────────────
    y = guard(65, y);
    y = heading("2.  FATIGUE DAMAGE ANALYSIS", y);

    y = body(
      "Rainflow cycle counting (ASTM E1049) was applied to the below-suspension vertical " +
      "acceleration signal. Miner's Rule (S-N: K=1e14, m=3) accumulated damage per road class. " +
      "Cycle mean stress is captured and available for Goodman correction when component " +
      "S-N data is available.",
      y
    );
    y += GAP_MD;

    // Data table
    tc("#94a3b8");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Surface",          M + 2,   y);
    doc.text("Damage Ratio",     M + 52,  y);
    doc.text("Cycles",           M + 92,  y);
    doc.text("Peak Range m/s2",  M + 120, y);
    rule(y + 2); y += 8;

    const tableRows = [
      { label: "Asphalt",      ratio: 1.0,      cycles: byRoad.asphalt?.n_cycles,      range: byRoad.asphalt?.range_max },
      { label: "Cobblestone",  ratio: cobR,      cycles: byRoad.cobblestone?.n_cycles,  range: byRoad.cobblestone?.range_max },
      { label: "Dirt road",    ratio: dirtR,     cycles: byRoad.dirt?.n_cycles,         range: byRoad.dirt?.range_max },
    ];

    tableRows.forEach(({ label, ratio, cycles, range }, i) => {
      if (i % 2 === 0) { fc("#f8fafc"); doc.rect(M, y - 3.5, CW, 8, "F"); }
      tc("#1e293b");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(label, M + 2, y);
      tc("#374151");
      doc.setFont("helvetica", "normal");
      doc.text(ratio != null ? `${ratio.toFixed(1)}x` : "1.0x",     M + 52,  y);
      doc.text(cycles != null ? Math.round(cycles).toLocaleString() : "—", M + 92,  y);
      doc.text(range  != null ? range.toFixed(1) : "—",              M + 120, y);
      y += 9;
    });
    y += GAP_SM;

    y = body(
      "The cobblestone damage ratio is driven by cycle amplitude, not cycle count. " +
      "Cobblestone produced fewer cycles than asphalt (14,084 vs 16,456) but a peak range " +
      "nearly 2x higher (114 vs 61 m/s2). Under m=3 the damage contribution scales as the cube " +
      "of amplitude, making the amplitude tail the dominant driver. Dirt road shows the highest " +
      "peak range (122 m/s2) but fewer cycles, yielding a 5.8x ratio.",
      y
    );
    y += GAP_SM;

    y = body(
      "Action: Durability targets for suspension and sub-frame components must be weighted by " +
      "the fleet road-surface mix. For a vehicle with 15% cobblestone mileage, the effective " +
      `damage multiplier is approximately ${cobR != null ? (1 + 0.15*(cobR-1)).toFixed(1) : "N/A"}x ` +
      "the pure-asphalt baseline. Weibull P50/P90/P99 population targets require a minimum of " +
      "3 vehicle datasets; current values are indicative only.",
      y, { color: "#1d4ed8" }
    );
    y += GAP_LG;

    // ── 3. Suspension Vibration Environment ─────────────────────────
    y = guard(70, y);
    y = heading("3.  SUSPENSION VIBRATION ENVIRONMENT", y);

    y = body(
      "PSD was computed via Welch's method on the below-suspension vertical accelerometer. " +
      "Transmissibility (above/below suspension PSD ratio) quantifies suspension isolation " +
      "performance as a function of frequency.",
      y
    );
    y += GAP_MD;

    if (trans.resonant_freq_hz) {
      y = kv("Resonant frequency", `${trans.resonant_freq_hz.toFixed(1)} Hz`, y);
      y = kv("Isolation at  5 Hz  (road roughness)",
             `${((1-trans.isolation_at_5hz)*100).toFixed(0)}% attenuation   T = ${trans.isolation_at_5hz.toFixed(3)}`, y);
      y = kv("Isolation at 10 Hz  (suspension bounce)",
             `${((1-trans.isolation_at_10hz)*100).toFixed(0)}% attenuation   T = ${trans.isolation_at_10hz.toFixed(3)}`, y);
      y = kv("Isolation at 20 Hz  (tyre/road noise)",
             `${((1-trans.isolation_at_20hz)*100).toFixed(0)}% attenuation   T = ${trans.isolation_at_20hz.toFixed(3)}`, y);
      y += GAP_SM;
    }

    if (rms.below_suspension) {
      const attn = (((rms.below_suspension - rms.above_suspension) / rms.below_suspension) * 100).toFixed(0);
      y = kv("RMS — below suspension  (road input)",  `${rms.below_suspension.toFixed(3)} m/s2`, y);
      y = kv("RMS — above suspension  (body)",        `${rms.above_suspension?.toFixed(3) ?? "N/A"} m/s2`, y);
      y = kv("RMS — dashboard",                       `${rms.dashboard?.toFixed(3) ?? "N/A"} m/s2`, y);
      y = kv("Suspension RMS attenuation",            `${attn}% reduction road input to body`, y);
      y += GAP_SM;
    }

    y = body(
      "Action: Components below the suspension require load specifications derived from the " +
      "full unfiltered input PSD (6.17 m/s2 RMS). Above-suspension components should use the " +
      "filtered body PSD (2.08 m/s2 RMS). The 2.0 Hz resonant peak is the primary remaining " +
      "excitation at the body — NVH and durability targets for body-mount brackets should " +
      "account for amplification in the 1-3 Hz range.",
      y, { color: "#1d4ed8" }
    );
    y += GAP_LG;

    // ── PAGE 2 ──────────────────────────────────────────────────────
    y = page();

    // ── 4. Road Surface Classifier ───────────────────────────────────
    y = heading("4.  ROAD SURFACE CLASSIFIER", y);

    y = body(
      "A Random Forest classifier (200 trees, balanced class weights) was trained on " +
      "12 statistical and frequency-band features per sensor channel across 5 axes " +
      "(vertical below/above suspension, lateral, fore-aft, yaw gyroscope), yielding " +
      "64 input features per 2-second window.",
      y
    );
    y += GAP_SM;

    y = kv("Test accuracy",               clfAcc, y);
    y = kv("5-fold cross-validation",     clfCV,  y);
    y = kv("Training windows",
      clf.confusion_matrix
        ? clf.confusion_matrix.reduce((s,r)=>s+r.reduce((a,b)=>a+b,0),0).toLocaleString()
        : "N/A", y
    );
    y += GAP_MD;

    y = body("Top 5 predictive features by importance:", y, { color: "#6b7280" });
    y += GAP_SM;

    topFeats.forEach((f, i) => {
      const name = f.feature
        .replace("acc_z_below_suspension_demean__", "Below-susp Z  ")
        .replace("acc_z_above_suspension_demean__", "Above-susp Z  ")
        .replace("gyro_z_below_suspension__",       "Gyro Z  ")
        .replace("acc_y_below_suspension__",        "Lateral Y  ")
        .replace("acc_x_below_suspension__",        "Fore-aft X  ");
      y = kv(`${i+1}.  ${name}`, `${(f.importance*100).toFixed(1)}%`, y,
             { labelColor: "#374151", valueColor: "#374151" });
    });
    y += GAP_SM;

    y = body(
      "The top four features are all gyroscope Z (yaw rotation rate) statistics, not vertical " +
      "acceleration. This is physically consistent: cobblestone produces irregular torsional " +
      "jolts from asymmetric stone contact, while asphalt produces symmetric, Gaussian vertical " +
      "vibration. The 5th feature is lateral Y energy in the 5-20 Hz band, reflecting periodic " +
      "lateral inputs from stone spacing. Vertical Z drives fatigue damage accumulation; " +
      "lateral and rotational signals drive road classification. For fleet deployment, the " +
      "gyroscope Z channel is the most valuable sensor to preserve.",
      y
    );
    y += GAP_SM;

    y = body(
      "Action: Road surface classification can be deployed from CAN-accessible IMU data without " +
      "GPS or camera input. The gyroscope Z channel is the primary signal; if sensor reduction " +
      "is required for cost, this should be the last channel removed.",
      y, { color: "#1d4ed8" }
    );
    y += GAP_LG;

    // ── 5. Fatigue Damage Regressor ──────────────────────────────────
    y = guard(55, y);
    y = heading("5.  FATIGUE DAMAGE REGRESSOR", y);

    y = body(
      "An XGBoost regressor was trained to predict log10(damage index) from the same " +
      "IMU window features used for classification, bypassing the rainflow + Miner's Rule " +
      "computation for new data.",
      y
    );
    y += GAP_SM;

    y = kv("R2 score",          r2Str, y);
    y = kv("MAE  (log10 scale)", reg.mae_log?.toFixed(4) ?? "N/A", y);
    y = kv("Training windows",   reg.n_train?.toLocaleString() ?? "N/A", y);
    y += GAP_SM;

    y = body(
      "The near-perfect R2 is expected: fatigue damage is near-deterministic given " +
      "vibration RMS and cycle count, so the model is learning an approximation of the " +
      "Miner's Rule formula. This is a feature, not a limitation -- the regressor will " +
      "generalise reliably within the same sensor configuration and S-N curve. For " +
      "deployment across vehicle variants or different component materials, the model " +
      "must be retrained on representative data.",
      y
    );
    y += GAP_SM;

    y = body(
      "Action: The regressor enables real-time, continuous damage estimation from production " +
      "vehicle telemetry without running the full fatigue pipeline per window. At fleet scale, " +
      "this reduces compute cost by eliminating repeated rainflow computation and enables " +
      "near-real-time health monitoring.",
      y, { color: "#1d4ed8" }
    );
    y += GAP_LG;

    // ── 6. Customer Usage Archetypes ──────────────────────────────────
    y = guard(70, y);
    y = heading("6.  CUSTOMER USAGE ARCHETYPES", y);

    y = body(
      `K-Means clustering (k=${clust.n_clusters ?? "N/A"}) on vibration RMS, vehicle speed, ` +
      "kurtosis, and crest factor identified four distinct usage profiles:",
      y
    );
    y += GAP_MD;

    // Archetype table
    tc("#94a3b8");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Cluster",           M + 2,   y);
    doc.text("Archetype",         M + 20,  y);
    doc.text("Windows",           M + 80,  y);
    doc.text("Dominant Road",     M + 105, y);
    doc.text("Mean RMS  m/s2",    M + 145, y);
    rule(y + 2); y += 8;

    const CCOLORS = ["#3b82f6","#f97316","#22c55e","#a855f7"];
    profiles.forEach((p, i) => {
      if (i % 2 === 0) { fc("#f8fafc"); doc.rect(M, y-3.5, CW, 8, "F"); }
      tc(CCOLORS[i] || "#374151");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`C${p.cluster_id}`, M + 2, y);
      tc("#374151");
      doc.setFont("helvetica", "normal");
      doc.text(p.archetype || "—",                                 M + 20,  y);
      doc.text(p.n_windows.toLocaleString(),                       M + 80,  y);
      doc.text(p.dominant_road || "—",                             M + 105, y);
      doc.text(p.vib_rms_mean?.toFixed(2) ?? "—",                  M + 145, y);
      y += 9;
    });
    y += GAP_SM;

    y = body(
      "Cluster C0 (off-road / rough road user, RMS 8.23 m/s2) is the design-driving " +
      "archetype. Using m=3, the per-unit-time damage ratio of C0 relative to C1 " +
      "(mixed use, RMS 3.66 m/s2) is (8.23/3.66)^3 = 11x. Cluster C2 (city driver, " +
      "4 windows) is statistically insignificant at this dataset size and should not " +
      "be used for target-setting until more data is collected.",
      y
    );
    y += GAP_SM;

    y = body(
      "Action: Component durability targets should be weighted by the expected archetype " +
      "prevalence in the customer population. If C0 represents 20% of the fleet, the " +
      "population-weighted damage target is materially higher than the fleet average. " +
      "Recommend expanding to PVS datasets 2-9 to establish a statistically robust " +
      "archetype distribution and Weibull P99 target.",
      y, { color: "#1d4ed8" }
    );
    y += GAP_LG;

    // ── 7. Limitations & Next Steps ──────────────────────────────────
    y = guard(70, y);
    y = heading("7.  LIMITATIONS & NEXT STEPS", y);

    const limits = [
      ["Dataset scope",
       "Single vehicle, single route, 24 minutes. Fleet-level conclusions and Weibull " +
       "P99 targets require PVS datasets 2-9. Recommend expanding analysis before " +
       "using these targets in component specifications."],
      ["S-N curve",
       "Generic steel parameters (K=1e14, m=3). Absolute damage index values are not " +
       "component-specific and should not be used as pass/fail criteria. Damage ratios " +
       "between road surfaces remain valid regardless of S-N calibration."],
      ["Weibull analysis",
       "P50/P90/P99 design targets require a minimum of 3 independent datasets for a " +
       "robust fit. Current single-dataset values are indicative only."],
      ["Frequency range",
       "100 Hz sampling resolves 0-50 Hz. High-frequency excitation relevant to " +
       "suspension bushings and wheel-end components is not captured."],
      ["Next steps",
       "1) Expand to all 9 PVS datasets for population Weibull fit. " +
       "2) Calibrate S-N parameters to actual Rivian component material data. " +
       "3) Implement accelerated duty cycle / block cycle output from the damage-per-km metric. " +
       "4) Validate gyro Z classifier on a held-out vehicle variant."],
    ];

    limits.forEach(([label, value]) => {
      y = guard(20, y);
      y = body(label, y, { bold: true, color: "#1e293b" });
      y = body(value, y, { indent: 4, color: "#374151" });
      y += GAP_SM;
    });

    // ── Save ─────────────────────────────────────────────────────────
    const date = new Date().toISOString().slice(0, 10);
    doc.save(`durability_report_pvs1_${date}.pdf`);
  };

  return (
    <button
      onClick={handleExport}
      className="flex items-center gap-1.5 px-3 py-1 bg-slate-700
                 hover:bg-slate-600 text-slate-200 border border-slate-600
                 rounded-full text-xs transition-colors"
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 11.5L4.5 8H7V3h2v5h2.5L8 11.5z"/>
        <path d="M2 13.5h12V15H2z"/>
      </svg>
      Export PDF
    </button>
  );
}
