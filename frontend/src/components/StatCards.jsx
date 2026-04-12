export default function StatCards({ data }) {
  const ml     = data.ml;
  const damage = data.damage;
  const byRoad = damage.by_road_class || {};

  const accuracy   = ml.classifier?.accuracy
    ? `${(ml.classifier.accuracy * 100).toFixed(1)}%` : "—";
  const cvAccuracy = ml.classifier?.cv_accuracy_mean
    ? `${(ml.classifier.cv_accuracy_mean * 100).toFixed(1)}%` : "—";
  const r2         = ml.regressor?.r2_score
    ? ml.regressor.r2_score.toFixed(3) : "—";
  const totalCycles = Object.values(byRoad)
    .reduce((s, v) => s + Math.round(v.n_cycles || 0), 0)
    .toLocaleString();
  const nClusters  = ml.clustering?.n_clusters ?? "—";
  const nWindows   = ml.clustering?.cluster_profiles
    ?.reduce((s, p) => s + p.n_windows, 0)
    .toLocaleString() ?? "—";

  const cards = [
    {
      label:  "Road surface classifier",
      value:  accuracy,
      sub:    `5-fold CV: ${cvAccuracy}`,
      color:  "text-green-400",
      bg:     "bg-green-900/20",
      border: "border-green-800/40",
    },
    {
      label:  "Cobblestone vs asphalt",
      value:  "10.1x",
      sub:    "Miner's Rule damage ratio",
      color:  "text-orange-400",
      bg:     "bg-orange-900/20",
      border: "border-orange-800/40",
    },
    {
      label:  "Dirt vs asphalt",
      value:  "5.8x",
      sub:    "Miner's Rule damage ratio",
      color:  "text-green-300",
      bg:     "bg-slate-700/40",
      border: "border-slate-600/40",
    },
    {
      label:  "Damage regressor R²",
      value:  r2,
      sub:    "XGBoost · IMU → damage",
      color:  "text-blue-400",
      bg:     "bg-blue-900/20",
      border: "border-blue-800/40",
    },
    {
      label:  "Rainflow cycles",
      value:  totalCycles,
      sub:    "All road classes",
      color:  "text-purple-400",
      bg:     "bg-purple-900/20",
      border: "border-purple-800/40",
    },
    {
      label:  "Usage archetypes",
      value:  String(nClusters),
      sub:    `${nWindows} windows clustered`,
      color:  "text-yellow-400",
      bg:     "bg-yellow-900/20",
      border: "border-yellow-800/40",
    },
  ];

  return (
    <div className="grid grid-cols-6 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`${card.bg} border ${card.border} rounded-xl p-4`}
        >
          <p className="text-slate-400 text-xs mb-2 leading-snug">
            {card.label}
          </p>
          <p className={`text-2xl font-semibold ${card.color} mb-1`}>
            {card.value}
          </p>
          <p className="text-slate-500 text-xs">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}