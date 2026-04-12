export default function ClassifierResults({ data }) {
  const clf     = data.classifier || {};
  const cm      = clf.confusion_matrix || [];
  const classes = clf.classes || [];
  const topFeats = (clf.top_features || []).slice(0, 8);

  const maxVal = cm.length
    ? Math.max(...cm.flat())
    : 1;

  const accuracy = clf.accuracy
    ? (clf.accuracy * 100).toFixed(1)
    : "N/A";
  const cvMean = clf.cv_accuracy_mean
    ? (clf.cv_accuracy_mean * 100).toFixed(1)
    : "N/A";

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-1">
        Road surface classifier
      </h2>
      <p className="text-slate-400 text-xs mb-4">
        Random Forest · {accuracy}% accuracy · 
        CV: {cvMean}% ± {clf.cv_accuracy_std
          ? (clf.cv_accuracy_std * 100).toFixed(1)
          : ""}%
      </p>

      {/* Confusion matrix */}
      {cm.length > 0 && (
        <div className="mb-5">
          <p className="text-slate-500 text-xs mb-2">Confusion matrix</p>
          <div
            className="grid gap-0.5"
            style={{
              gridTemplateColumns: `auto repeat(${classes.length}, 1fr)`,
            }}
          >
            {/* Header row */}
            <div />
            {classes.map(c => (
              <div
                key={c}
                className="text-slate-500 text-center"
                style={{ fontSize: "9px" }}
              >
                {c.slice(0, 5)}
              </div>
            ))}
            {/* Data rows */}
            {cm.map((row, i) => (
              <>
                <div
                  key={`label-${i}`}
                  className="text-slate-500 text-right pr-1"
                  style={{ fontSize: "9px" }}
                >
                  {classes[i]?.slice(0, 5)}
                </div>
                {row.map((val, j) => (
                  <div
                    key={`${i}-${j}`}
                    className="flex items-center justify-center 
                               rounded text-xs font-medium py-1"
                    style={{
                      backgroundColor: i === j
                        ? `rgba(34, 197, 94, ${0.15 + 0.7 * (val / maxVal)})`
                        : val > 0
                          ? `rgba(239, 68, 68, ${0.1 + 0.5 * (val / maxVal)})`
                          : "rgba(30, 41, 59, 0.5)",
                      color: i === j ? "#86efac" : val > 0 ? "#fca5a5" : "#475569",
                    }}
                  >
                    {val}
                  </div>
                ))}
              </>
            ))}
          </div>
        </div>
      )}

      {/* Top features */}
      <div>
        <p className="text-slate-500 text-xs mb-2">Top features</p>
        <div className="space-y-1.5">
          {topFeats.map((feat, i) => {
            const name = feat.feature
              .replace("acc_z_below_suspension_demean__", "↓susp·")
              .replace("acc_z_above_suspension_demean__", "↑susp·")
              .replace("gyro_z_below_suspension__", "gyro·")
              .replace("acc_y_below_suspension__", "acc_y·");
            const pct = (feat.importance * 100).toFixed(1);
            return (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="text-slate-500 shrink-0"
                  style={{ fontSize: "10px", width: "12px" }}
                >
                  {i + 1}
                </span>
                <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full"
                    style={{ width: `${feat.importance * 1200}%` }}
                  />
                </div>
                <span
                  className="text-slate-400 shrink-0"
                  style={{ fontSize: "10px", width: "120px" }}
                >
                  {name}
                </span>
                <span
                  className="text-slate-500 shrink-0"
                  style={{ fontSize: "10px" }}
                >
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}