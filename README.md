# Durability Analytics Platform

End-to-end vehicle durability pipeline — raw IMU signals → fatigue damage estimation → road surface classification → interactive dashboard.

## Results

| Metric | Value |
|--------|-------|
| Road surface classifier | 92.5% accuracy (CV: 93.7%) |
| Damage regressor R² | 0.999 |
| Cobblestone vs asphalt | 10.1x more fatigue damage |
| Dirt vs asphalt | 5.8x more fatigue damage |
| Rainflow cycles counted | 36,144 |

## Pipeline

| Module | Methods |
|--------|---------|
| Signal processing | FFT, Welch PSD, transmissibility |
| Fatigue estimation | Rainflow counting, Miner's Rule, Weibull |
| ML classification | Random Forest, XGBoost, K-Means |
| Dashboard | React, Recharts, Leaflet |

## Dataset

PVS — Passive Vehicular Sensors (Kaggle) · 3 vehicles · 3 drivers · 3 routes · 100Hz · accelerometer + gyroscope at suspension arm, body, and dashboard.

## Quickstart

```bash
git clone https://github.com/jmayank574/durability-analytics
cd durability-analytics
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
# Download PVS CSVs from Kaggle → data/raw/
python run_pipeline.py
cd frontend && npm install && npm run dev
```

## Stack

Python · pandas · scipy · rainflow · scikit-learn · XGBoost · React · Recharts · Leaflet · Tailwind