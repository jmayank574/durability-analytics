import { jsPDF } from "jspdf";

function hex(h) {
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return [r, g, b];
}

const ROAD_COLORS  = { asphalt: "#3b82f6", cobblestone: "#f97316", dirt: "#22c55e" };
const ROAD_LABELS  = { asphalt: "Asphalt", cobblestone: "Cobblestone", dirt: "Dirt road" };

export default function ExportPDF({ data }) {
  const handleExport = () => {
    const doc  = new jsPDF({ unit: "mm", format: "a4" });
    const W    = 210;
    const M    = 18;
    const CW   = W - M * 2;
    let y      = 0;

    // ── helpers ─────────────────────────────────────────────────────
    const setTxt = (hexColor) => doc.setTextColor(...hex(hexColor));
    const setFill = (hexColor) => doc.setFillColor(...hex(hexColor));
    const setDraw = (hexColor) => doc.setDrawColor(...hex(hexColor));

    const rule = (yp, c = "#e2e8f0") => {
      setDraw(c);
      doc.setLineWidth(0.25);
      doc.line(M, yp, W - M, yp);
    };

    const sectionTitle = (label, yp) => {
      setFill("#f1f5f9");
      doc.rect(M, yp - 4, CW, 9, "F");
      setTxt("#1e293b");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(label, M + 3, yp + 1.5);
      return yp + 12;
    };

    const row = (label, value, yp, valColor = "#1e293b", even = false) => {
      if (even) { setFill("#f8fafc"); doc.rect(M, yp - 3.5, CW, 7, "F"); }
      setTxt("#64748b");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(label, M + 2, yp);
      setTxt(valColor);
      doc.setFont("helvetica", "bold");
      doc.text(value, M + 100, yp);
    };

    const newPage = () => { doc.addPage(); return 20; };

    // ── data ────────────────────────────────────────────────────────
    const damage    = data.damage    || {};
    const ml        = data.ml        || {};
    const psd       = data.psd       || {};
    const byRoad    = damage.by_road_class || {};
    const clf       = ml.classifier  || {};
    const reg       = ml.regressor   || {};
    const clust     = ml.clustering  || {};
    const trans     = Object.values(psd.transmissibility || {})[0] || {};
    const rms       = Object.values(psd.rms_summary     || {})[0] || {};
    const profiles  = clust.cluster_profiles || [];

    const cobRatio  = byRoad.cobblestone?.damage_relative_to_asphalt;
    const dirtRatio = byRoad.dirt?.damage_relative_to_asphalt;
    const clfAcc    = clf.accuracy        ? `${(clf.accuracy * 100).toFixed(1)}%`        : "—";
    const clfCV     = clf.cv_accuracy_mean
      ? `${(clf.cv_accuracy_mean * 100).toFixed(1)}%  ±  ${(clf.cv_accuracy_std * 100).toFixed(1)}%`
      : "—";
    const r2Str     = reg.r2_score != null ? reg.r2_score.toFixed(4) : "—";

    // ── PAGE 1 ──────────────────────────────────────────────────────

    // Title bar
    setFill("#0f172a");
    doc.rect(0, 0, W, 38, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text("Vehicle Durability Analytics Report", M, 16);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      "PVS Dataset  ·  144,036 samples  ·  100 Hz  ·  24 min  ·  Below-suspension IMU",
      M, 25
    );
    doc.text(
      `Generated  ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      M, 32
    );

    y = 50;

    // ── Executive Summary ──────────────────────────────────────────
    y = sectionTitle("EXECUTIVE SUMMARY", y);

    const summaryRows = [
      ["Road surface classifier — test accuracy",     clfAcc,                                          "#1e293b"],
      ["Road surface classifier — 5-fold CV",         clfCV,                                           "#1e293b"],
      ["Fatigue damage regressor R²  (XGBoost)",      r2Str,                                           "#1e293b"],
      ["Cobblestone fatigue damage vs asphalt",        cobRatio != null ? `${cobRatio.toFixed(1)}×  more damaging` : "—",  "#f97316"],
      ["Dirt road fatigue damage vs asphalt",          dirtRatio != null ? `${dirtRatio.toFixed(1)}×  more damaging` : "—", "#16a34a"],
      ["Equivalent exposure  (1 hr cobblestone)",      cobRatio != null ? `= ${cobRatio.toFixed(0)} hrs on asphalt` : "—",  "#f97316"],
      ["Customer usage archetypes identified",         `${clust.n_clusters ?? "—"}  clusters`,          "#1e293b"],
    ];

    summaryRows.forEach(([label, value, vc], i) => {
      row(label, value, y + i * 8, vc, i % 2 === 0);
    });
    y += summaryRows.length * 8 + 10;

    // ── Fatigue Damage Analysis ────────────────────────────────────
    y = sectionTitle("FATIGUE DAMAGE ANALYSIS  ·  Rainflow (ASTM E1049) + Miner's Rule  (S-N: K=1e14, m=3)", y);

    // Column headers
    setTxt("#94a3b8");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("Surface",           M + 2,   y);
    doc.text("Damage Index",      M + 38,  y);
    doc.text("Ratio",             M + 70,  y);
    doc.text("Cycles",            M + 100, y);
    doc.text("Peak Range  m/s²",  M + 130, y);
    rule(y + 2);
    y += 8;

    const maxRatio   = Math.max(...Object.values(byRoad).map(v => v.damage_relative_to_asphalt ?? 1), 1);
    const barMaxW    = 24;

    ["asphalt", "cobblestone", "dirt"].forEach((road, i) => {
      const v     = byRoad[road] || {};
      const ratio = v.damage_relative_to_asphalt ?? 1;
      const ry    = y + i * 11;

      if (i % 2 === 0) { setFill("#f8fafc"); doc.rect(M, ry - 3.5, CW, 9.5, "F"); }

      // Color dot
      setFill(ROAD_COLORS[road]);
      doc.circle(M + 3, ry + 0.5, 1.3, "F");

      setTxt("#1e293b");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text(ROAD_LABELS[road], M + 7, ry + 1.5);

      setTxt("#475569");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(
        v.damage_index != null ? v.damage_index.toExponential(3) : "—",
        M + 38, ry + 1.5
      );

      // Bar
      const bw = (ratio / maxRatio) * barMaxW;
      setFill("#e2e8f0");
      doc.rect(M + 70, ry - 2, barMaxW, 6, "F");
      setFill(ROAD_COLORS[road]);
      doc.rect(M + 70, ry - 2, bw, 6, "F");

      setTxt(ROAD_COLORS[road]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text(`${ratio.toFixed(1)}×`, M + 70 + barMaxW + 2, ry + 1.5);

      setTxt("#475569");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(
        v.n_cycles != null ? Math.round(v.n_cycles).toLocaleString() : "—",
        M + 100, ry + 1.5
      );
      doc.text(
        v.range_max != null ? v.range_max.toFixed(1) : "—",
        M + 130, ry + 1.5
      );
    });
    y += 3 * 11 + 8;

    // ── Suspension Vibration Environment ──────────────────────────
    if (trans.resonant_freq_hz) {
      y = sectionTitle("SUSPENSION VIBRATION ENVIRONMENT  ·  PSD + Transmissibility", y);

      const susRows = [
        ["Suspension resonant frequency",                  `${trans.resonant_freq_hz.toFixed(1)} Hz`],
        ["Isolation at  5 Hz  (road roughness)",           `${((1 - trans.isolation_at_5hz)  * 100).toFixed(0)}%  attenuation   (T = ${trans.isolation_at_5hz.toFixed(3)})`],
        ["Isolation at 10 Hz  (suspension bounce)",        `${((1 - trans.isolation_at_10hz) * 100).toFixed(0)}%  attenuation   (T = ${trans.isolation_at_10hz.toFixed(3)})`],
        ["Isolation at 20 Hz  (tyre/road noise)",          `${((1 - trans.isolation_at_20hz) * 100).toFixed(0)}%  attenuation   (T = ${trans.isolation_at_20hz.toFixed(3)})`],
        ["RMS — below suspension  (road input)",           `${rms.below_suspension?.toFixed(3) ?? "—"} m/s²`],
        ["RMS — above suspension  (body)",                 `${rms.above_suspension?.toFixed(3) ?? "—"} m/s²`],
        ["RMS — dashboard",                                `${rms.dashboard?.toFixed(3) ?? "—"} m/s²`],
      ];

      susRows.forEach(([label, value], i) => {
        row(label, value, y + i * 8, "#1e293b", i % 2 === 0);
      });
      y += susRows.length * 8 + 8;
    }

    // ── PAGE 2 ──────────────────────────────────────────────────────
    y = newPage();

    // ── ML Model Performance ──────────────────────────────────────
    y = sectionTitle("ML MODEL PERFORMANCE", y);

    // Classifier block
    setTxt("#334155");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("Road Surface Classifier  (Random Forest, 200 trees, balanced class weights)", M + 2, y);
    y += 7;

    [
      ["Test accuracy",             clfAcc],
      ["5-fold cross-validation",   clfCV],
    ].forEach(([label, value], i) => {
      row(label, value, y + i * 8, "#1e293b", i % 2 === 0);
    });
    y += 2 * 8 + 6;

    // Top 5 features
    setTxt("#64748b");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("Top 5 predictive features:", M + 2, y);
    y += 6;

    const topFeats  = (clf.top_features || []).slice(0, 5);
    const featBarW  = 50;

    topFeats.forEach((feat, i) => {
      const name = feat.feature
        .replace("acc_z_below_suspension_demean__", "↓Z · ")
        .replace("acc_z_above_suspension_demean__", "↑Z · ")
        .replace("gyro_z_below_suspension__",       "gyro · ")
        .replace("acc_y_below_suspension__",        "Y · ")
        .replace("acc_x_below_suspension__",        "X · ");
      const ry = y + i * 8;
      const bw = feat.importance * featBarW * 10;

      if (i % 2 === 0) { setFill("#f8fafc"); doc.rect(M, ry - 3.5, CW, 7, "F"); }

      setFill("#93c5fd");
      doc.rect(M + 2, ry - 2.5, bw, 5, "F");

      setTxt("#1e293b");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`${i + 1}.  ${name}`, M + bw + 5, ry + 0.5);

      setTxt("#64748b");
      doc.text(`${(feat.importance * 100).toFixed(1)}%`, M + 155, ry + 0.5);
    });
    y += topFeats.length * 8 + 10;

    // Regressor block
    setTxt("#334155");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("Fatigue Damage Regressor  (XGBoost — real-time damage prediction without rainflow)", M + 2, y);
    y += 7;

    [
      ["R² score",                    r2Str],
      ["MAE (log₁₀ scale)",           reg.mae_log != null ? reg.mae_log.toFixed(4) : "—"],
      ["Training windows",            reg.n_train != null ? reg.n_train.toLocaleString() : "—"],
    ].forEach(([label, value], i) => {
      row(label, value, y + i * 8, "#1e293b", i % 2 === 0);
    });
    y += 3 * 8 + 12;

    // ── Fleet Usage Archetypes ────────────────────────────────────
    y = sectionTitle(`FLEET USAGE ARCHETYPES  ·  K-Means  (k = ${clust.n_clusters ?? "—"})`, y);

    const CLUST_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#a855f7"];

    // Column headers
    setTxt("#94a3b8");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("ID",              M + 2,   y);
    doc.text("Archetype",       M + 14,  y);
    doc.text("Windows",         M + 80,  y);
    doc.text("Dominant Road",   M + 104, y);
    doc.text("Vib RMS  m/s²",   M + 145, y);
    rule(y + 2);
    y += 8;

    profiles.forEach((p, i) => {
      const ry = y + i * 10;
      if (i % 2 === 0) { setFill("#f8fafc"); doc.rect(M, ry - 3.5, CW, 8.5, "F"); }

      setFill(CLUST_COLORS[i] || "#94a3b8");
      doc.circle(M + 4, ry + 0.5, 1.5, "F");

      setTxt("#1e293b");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text(`C${p.cluster_id}`, M + 8, ry + 1.5);

      setTxt("#334155");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(p.archetype || "—", M + 14, ry + 1.5);

      setTxt("#475569");
      doc.setFontSize(8);
      doc.text(p.n_windows.toLocaleString(),        M + 80,  ry + 1.5);
      doc.text(p.dominant_road || "—",              M + 104, ry + 1.5);
      doc.text(p.vib_rms_mean?.toFixed(2) ?? "—",   M + 145, ry + 1.5);
    });
    y += profiles.length * 10 + 12;

    // ── Methodology & Limitations ─────────────────────────────────
    if (y > 230) y = newPage();
    y = sectionTitle("METHODOLOGY & KNOWN LIMITATIONS", y);

    const methodLines = [
      { t: "Fatigue pipeline:", v: "Rainflow (ASTM E1049) → Miner's Rule (K=1e14, m=3) → optional Goodman mean-stress correction", lim: false },
      { t: "Weibull analysis:", v: "P50/P90/P99 design targets fitted per-window. Requires ≥ 3 datasets for a population-level fit.", lim: false },
      { t: "Classifier:",       v: "Random Forest on 12 statistical + frequency-band features per channel, across 5 sensor axes.", lim: false },
      { t: "Regressor:",        v: "XGBoost on log₁₀(damage). R² ≈ 1 because damage is near-deterministic given RMS + cycle count.", lim: false },
      { t: "Dataset scope:",    v: "PVS1 only — 1 vehicle, 1 route, 24 min. Population Weibull targets are indicative only.", lim: true  },
      { t: "S-N curve:",        v: "Generic steel parameters (K=1e14, m=3). Absolute damage requires calibration to component test data.", lim: true  },
      { t: "Frequency range:",  v: "100 Hz sampling → 0–50 Hz. High-frequency resonance effects above 50 Hz are not captured.", lim: true  },
    ];

    methodLines.forEach(({ t, v }, i) => {
      const ry = y + i * 8;
      if (i % 2 === 0) { setFill("#f8fafc"); doc.rect(M, ry - 3.5, CW, 7, "F"); }
      setTxt("#334155");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(t, M + 2, ry);
      setTxt("#475569");
      doc.setFont("helvetica", "normal");
      doc.text(v, M + 38, ry);
    });

    // ── Save ─────────────────────────────────────────────────────
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
