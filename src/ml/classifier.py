"""
src/ml/classifier.py

Module 4: Machine Learning — Road Surface Classification & Damage Prediction
-----------------------------------------------------------------------------
Three models:

  1. Random Forest classifier — predicts road surface type from raw IMU
     features (no GPS, no camera). This is the core capability Rivian
     needs to classify fleet usage from CAN data signals.

  2. XGBoost regressor — predicts fatigue damage index from IMU features.
     Eliminates need for repeated rainflow computation on new data.

  3. K-Means clustering — groups datasets into usage archetypes.
     Answers: "what type of customer/driver is this?"

Rivian JD alignment:
  "Build classification models to identify usage archetypes"
  "Develop ML models to estimate vehicle loads from CAN data signals"
  "Apply ML on past results to reduce number of CAE test cases"
"""

import numpy as np
import pandas as pd
import json
import yaml
from pathlib import Path
from tqdm import tqdm

from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    mean_absolute_error,
    r2_score,
)
from sklearn.cluster import KMeans
import xgboost as xgb


def load_config(config_path: str = "config.yaml") -> dict:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


# ------------------------------------------------------------------ #
# Feature preparation
# ------------------------------------------------------------------ #

def prepare_features(
    windows: pd.DataFrame,
    target_col: str = "label",
    drop_cols: list = None,
) -> tuple:
    """
    Prepare feature matrix X and target vector y from window DataFrame.
    Drops non-feature columns and handles missing values.

    Returns:
        X         : feature DataFrame
        y         : target Series
        feature_names : list of feature column names
    """
    if drop_cols is None:
        drop_cols = [
            "label", "window_start", "time_sec",
            "dataset_id", "has_speed_bump",
        ]

    # Target
    y = windows[target_col].copy()

    # Features — drop all non-numeric and metadata columns
    X = windows.drop(
        columns=[c for c in drop_cols if c in windows.columns],
        errors="ignore"
    )

    # Keep only numeric columns
    X = X.select_dtypes(include=[np.number])

    # Fill any remaining NaN with column median
    X = X.fillna(X.median())

    feature_names = X.columns.tolist()
    print(f"  Feature matrix: {X.shape[0]:,} samples × {X.shape[1]} features")

    return X, y, feature_names


# ------------------------------------------------------------------ #
# Model 1: Road Surface Classifier
# ------------------------------------------------------------------ #

def train_road_classifier(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series,
    config: dict,
) -> tuple:
    """
    Train a Random Forest classifier to predict road surface type
    from IMU features.

    Why Random Forest?
      - Handles the non-linear relationships in vibration features well
      - Naturally provides feature importance rankings
      - Robust to outliers (important with impulsive sensor data)
      - No scaling required
      - Fast to train and interpret

    Returns: (trained model, metrics dict)
    """
    clf_config = config["ml"]["classifier"]

    print(f"  Training Random Forest ({clf_config['n_estimators']} trees)...")

    clf = RandomForestClassifier(
        n_estimators = clf_config["n_estimators"],
        max_depth    = clf_config["max_depth"],
        random_state = config["ml"]["random_seed"],
        n_jobs       = -1,  # Use all CPU cores
        class_weight = "balanced",  # Handle class imbalance
    )

    clf.fit(X_train, y_train)

    # Evaluate
    y_pred    = clf.predict(X_test)
    y_pred_proba = clf.predict_proba(X_test)

    # Cross-validation accuracy
    cv_scores = cross_val_score(
        clf, pd.concat([X_train, X_test]),
        pd.concat([y_train, y_test]),
        cv=5, scoring="accuracy", n_jobs=-1
    )

    # Feature importance
    importance_df = pd.DataFrame({
        "feature":   X_train.columns,
        "importance": clf.feature_importances_,
    }).sort_values("importance", ascending=False)

    metrics = {
        "accuracy":          float((y_pred == y_test).mean()),
        "cv_accuracy_mean":  float(cv_scores.mean()),
        "cv_accuracy_std":   float(cv_scores.std()),
        "classification_report": classification_report(
            y_test, y_pred, output_dict=True
        ),
        "confusion_matrix":  confusion_matrix(
            y_test, y_pred,
            labels=clf.classes_
        ).tolist(),
        "classes":           clf.classes_.tolist(),
        "top_features":      importance_df.head(15).to_dict("records"),
        "cv_scores":         cv_scores.tolist(),
    }

    print(f"  Accuracy: {metrics['accuracy']:.3f} "
          f"| CV: {metrics['cv_accuracy_mean']:.3f} "
          f"± {metrics['cv_accuracy_std']:.3f}")

    return clf, metrics


# ------------------------------------------------------------------ #
# Model 2: Fatigue Damage Regressor
# ------------------------------------------------------------------ #

def train_damage_regressor(
    windows:    pd.DataFrame,
    damage_col: str,
    config:     dict,
) -> tuple:
    """
    Train XGBoost to predict fatigue damage index from IMU window features.

    This is the key productivity tool:
    Once trained, you can predict damage from raw sensor signals
    without running the full rainflow + Miner's pipeline on every window.
    Critical for real-time fleet monitoring at scale.

    Returns: (trained model, metrics dict)
    """
    print("  Preparing damage regression features...")

    # Only use windows with non-zero damage
    valid = windows[windows[damage_col] > 0].copy()
    if len(valid) < 50:
        return None, {"error": "insufficient non-zero damage samples"}

    # Log-transform damage (spans many orders of magnitude)
    valid["log_damage"] = np.log10(valid[damage_col])

    X, _, feature_names = prepare_features(
        valid,
        target_col  = damage_col,
        drop_cols   = ["label", "window_start", "time_sec",
                       "dataset_id", damage_col, "log_damage",
                       "has_speed_bump"],
    )
    y = valid["log_damage"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size    = config["ml"]["test_split"],
        random_state = config["ml"]["random_seed"],
    )

    reg_config = config["ml"]["regressor"]
    print(f"  Training XGBoost regressor...")

    reg = xgb.XGBRegressor(
        n_estimators  = reg_config["n_estimators"],
        max_depth     = reg_config["max_depth"],
        learning_rate = reg_config["learning_rate"],
        random_state  = config["ml"]["random_seed"],
        n_jobs        = -1,
    )

    reg.fit(
        X_train, y_train,
        eval_set              = [(X_test, y_test)],
        verbose               = False,
    )

    y_pred = reg.predict(X_test)

    # Back-transform for interpretable error
    mae_log    = float(mean_absolute_error(y_test, y_pred))
    r2         = float(r2_score(y_test, y_pred))

    # Feature importance
    importance_df = pd.DataFrame({
        "feature":    feature_names,
        "importance": reg.feature_importances_,
    }).sort_values("importance", ascending=False)

    metrics = {
        "r2_score":     r2,
        "mae_log":      mae_log,
        "n_train":      len(X_train),
        "n_test":       len(X_test),
        "top_features": importance_df.head(15).to_dict("records"),
        "y_test":       y_test.tolist(),
        "y_pred":       y_pred.tolist(),
    }

    print(f"  R² score: {r2:.3f} | MAE (log scale): {mae_log:.3f}")

    return reg, metrics


# ------------------------------------------------------------------ #
# Model 3: Usage Archetype Clustering
# ------------------------------------------------------------------ #

def cluster_usage_archetypes(
    windows: pd.DataFrame,
    config:  dict,
) -> tuple:
    """
    K-Means clustering to identify usage archetypes.

    Uses aggregate features per dataset window group:
      - Mean RMS acceleration (how rough the roads are)
      - Mean speed (how fast they drive)
      - Damage index (how severe the fatigue loading is)
      - Road quality score (what roads they use)

    Archetypes might look like:
      Cluster 0: "Highway commuter"  — high speed, low RMS, low damage
      Cluster 1: "City driver"       — low speed, medium RMS
      Cluster 2: "Off-road user"     — any speed, very high RMS, high damage
      Cluster 3: "Mixed use"         — everything in between

    This is exactly the usage archetype mapping Rivian needs for
    fleet-level durability target development.
    """
    n_clusters = config["ml"]["clustering"]["n_clusters"]

    # Build clustering feature set
    cluster_features = []
    available = []

    rms_col = "acc_z_below_suspension_demean__rms"
    if rms_col in windows.columns:
        cluster_features.append(windows[rms_col])
        available.append("vib_rms")

    if "speed_mean" in windows.columns:
        cluster_features.append(windows["speed_mean"])
        available.append("speed_mean")

    if "acc_z_below_suspension_demean__kurtosis" in windows.columns:
        cluster_features.append(
            windows["acc_z_below_suspension_demean__kurtosis"]
        )
        available.append("kurtosis")

    if "acc_z_below_suspension_demean__crest_factor" in windows.columns:
        cluster_features.append(
            windows["acc_z_below_suspension_demean__crest_factor"]
        )
        available.append("crest_factor")

    if not cluster_features:
        return None, {"error": "no clustering features available"}

    X_cluster = pd.concat(cluster_features, axis=1)
    X_cluster.columns = available
    X_cluster = X_cluster.fillna(X_cluster.median())

    # Scale features before clustering
    scaler   = StandardScaler()
    X_scaled = scaler.fit_transform(X_cluster)

    print(f"  K-Means clustering with k={n_clusters}...")

    kmeans = KMeans(
        n_clusters  = n_clusters,
        random_state = config["ml"]["random_seed"],
        n_init      = 10,
    )
    labels = kmeans.fit_predict(X_scaled)

    # Characterize each cluster
    X_cluster["cluster"] = labels
    if "label" in windows.columns:
        X_cluster["road_type"] = windows["label"].values

    cluster_profiles = []
    for i in range(n_clusters):
        mask    = X_cluster["cluster"] == i
        profile = {"cluster_id": i, "n_windows": int(mask.sum())}

        for feat in available:
            profile[f"{feat}_mean"] = round(
                float(X_cluster.loc[mask, feat].mean()), 4
            )

        if "road_type" in X_cluster.columns:
            road_dist = X_cluster.loc[mask, "road_type"].value_counts()
            profile["dominant_road"] = road_dist.index[0] \
                if len(road_dist) > 0 else "unknown"
            profile["road_distribution"] = road_dist.to_dict()

        # Assign archetype label based on RMS and speed
        if "vib_rms" in available and "speed_mean" in available:
            rms_val   = profile.get("vib_rms_mean", 0)
            spd_val   = profile.get("speed_mean", 0)
            profile["archetype"] = _label_archetype(rms_val, spd_val)

        cluster_profiles.append(profile)

    metrics = {
        "n_clusters":       n_clusters,
        "cluster_profiles": cluster_profiles,
        "labels":           labels.tolist(),
        "features_used":    available,
        "inertia":          float(kmeans.inertia_),
    }

    print(f"  Clustered {len(windows):,} windows into "
          f"{n_clusters} archetypes")
    for p in cluster_profiles:
        print(f"    Cluster {p['cluster_id']}: "
              f"{p['n_windows']:,} windows | "
              f"{p.get('archetype', 'unknown')} | "
              f"dominant road: {p.get('dominant_road', 'unknown')}")

    return kmeans, metrics


def _label_archetype(rms: float, speed: float) -> str:
    """Assign a human-readable label based on RMS and speed."""
    if rms < 1.0 and speed > 10:
        return "highway commuter"
    elif rms < 2.0 and speed <= 10:
        return "city driver"
    elif rms >= 5.0:
        return "off-road / rough road user"
    else:
        return "mixed use driver"


# ------------------------------------------------------------------ #
# Build full ML export
# ------------------------------------------------------------------ #

def build_ml_export(
    windows:    pd.DataFrame,
    config:     dict,
    damage_col: str = "damage_index",
) -> dict:
    """
    Train all three models and build the JSON export for the dashboard.
    """
    export = {}

    # ---- Classifier ----
    print("\n[1/3] Road surface classifier")
    clf_drop = [
        "label", "window_start", "time_sec", "dataset_id",
        "has_speed_bump",
        "speed_mean",    # driver behaviour — not a road surface property
        "damage_index",  # derived from road type — would be circular leakage
    ]
    X, y, feat_names = prepare_features(windows, target_col="label", drop_cols=clf_drop)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size    = config["ml"]["test_split"],
        random_state = config["ml"]["random_seed"],
        stratify     = y,
    )

    clf, clf_metrics = train_road_classifier(
        X_train, y_train, X_test, y_test, config
    )
    export["classifier"] = clf_metrics

    # ---- Regressor ----
    print("\n[2/3] Fatigue damage regressor")
    if damage_col in windows.columns:
        reg, reg_metrics = train_damage_regressor(windows, damage_col, config)
        export["regressor"] = reg_metrics
    else:
        print(f"  Skipping — '{damage_col}' column not found in windows")
        print(f"  Available columns: {[c for c in windows.columns[:10]]}")
        export["regressor"] = {"skipped": True}

    # ---- Clustering ----
    print("\n[3/3] Usage archetype clustering")
    kmeans, cluster_metrics = cluster_usage_archetypes(windows, config)
    export["clustering"] = cluster_metrics

    return export, clf, reg if damage_col in windows.columns else None


def save_ml_export(export: dict, config: dict) -> None:
    out_dir  = Path(config["data"]["exports_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / config["export"]["files"]["ml_results"]

    # Convert any non-serializable types
    def make_serializable(obj):
        if isinstance(obj, (np.integer, np.floating)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return obj

    with open(out_path, "w") as f:
        json.dump(export, f, indent=2, default=make_serializable)
    size_kb = out_path.stat().st_size / 1000
    print(f"\n  Saved {out_path.name} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    from src.ingestion.loader import load_config

    config  = load_config()
    windows = pd.read_csv("data/processed/feature_windows.csv")
    print(f"Loaded {len(windows):,} windows")

    export, clf, reg = build_ml_export(windows, config)
    save_ml_export(export, config)