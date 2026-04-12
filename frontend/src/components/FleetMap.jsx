import { useEffect, useRef } from "react";

const ROAD_COLORS = {
  asphalt:     "#60a5fa",
  cobblestone: "#fb923c",
  dirt:        "#4ade80",
  unknown:     "#94a3b8",
};

export default function FleetMap({ data }) {
  const mapRef     = useRef(null);
  const leafletRef = useRef(null);

  useEffect(() => {
    if (!data?.points || leafletRef.current) return;

    import("leaflet").then(L => {
      // Fix default marker icons
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });

      const points   = data.points;
      const centerLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
      const centerLng = points.reduce((s, p) => s + p.lng, 0) / points.length;

      const map = L.map(mapRef.current).setView([centerLat, centerLng], 14);
      leafletRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "© OpenStreetMap © CARTO", maxZoom: 19 }
      ).addTo(map);

      // Plot points colored by road type
      // Sample every 3rd point for performance
      points
        .filter((_, i) => i % 3 === 0)
        .forEach(point => {
          const color  = ROAD_COLORS[point.road_type] || "#94a3b8";
          L.circleMarker([point.lat, point.lng], {
            radius:      3,
            fillColor:   color,
            color:       color,
            weight:      1,
            opacity:     0.8,
            fillOpacity: 0.8,
          })
          .bindPopup(`
            <div style="font-size:12px; color:#1e293b">
              <b>${point.road_type}</b><br/>
              Speed: ${point.speed} m/s<br/>
              Dataset: ${point.dataset_id}
            </div>
          `)
          .addTo(map);
        });
    });

    return () => {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
      }
    };
  }, [data]);

  // Add leaflet CSS
  useEffect(() => {
    const link = document.createElement("link");
    link.rel   = "stylesheet";
    link.href  = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(link);
  }, []);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Fleet GPS map — road surface classification
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            {data?.n_points?.toLocaleString()} GPS points · 
            colored by road type
          </p>
        </div>
        <div className="flex gap-3 text-xs">
          {Object.entries(ROAD_COLORS)
            .filter(([k]) => k !== "unknown")
            .map(([road, color]) => (
            <span key={road} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ backgroundColor: color }}
              />
              <span className="text-slate-400 capitalize">{road}</span>
            </span>
          ))}
        </div>
      </div>
      <div
        ref={mapRef}
        className="w-full rounded-lg overflow-hidden"
        style={{ height: "380px" }}
      />
    </div>
  );
}