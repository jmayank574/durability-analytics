"""
download_pvs.py
---------------
Downloads specific PVS dataset files from Kaggle and places them in
data/raw/ with the correct prefix naming convention for run_pipeline.py.

Prerequisites:
    pip install kagglehub
    Save your Kaggle API token to C:/Users/<you>/.kaggle/access_token

Usage:
    python download_pvs.py 2 3        # Download PVS 2 and PVS 3
    python download_pvs.py 2          # Download PVS 2 only
    python download_pvs.py 1 2 3      # Download PVS 1, 2 and 3
"""

import sys
import shutil
from pathlib import Path

DATASET = "jefmenegazzo/pvs-passive-vehicular-sensors-datasets"
RAW_DIR = Path("data/raw")

FILES = [
    "dataset_gps_mpu_left.csv",
    "dataset_gps_mpu_right.csv",
    "dataset_labels.csv",
    "dataset_gps.csv",
]


def download_pvs(pvs_nums: list) -> None:
    try:
        import kagglehub
    except ImportError:
        print("ERROR: kagglehub not installed. Run: pip install kagglehub")
        sys.exit(1)

    RAW_DIR.mkdir(parents=True, exist_ok=True)

    for num in pvs_nums:
        prefix = f"pvs{num}"
        folder = f"PVS {num}"
        print(f"\n{'='*50}")
        print(f"  {folder}")
        print(f"{'='*50}")

        for filename in FILES:
            target_path = RAW_DIR / f"{prefix}_{filename}"

            if target_path.exists():
                size_mb = target_path.stat().st_size / 1_000_000
                print(f"  [skip]  {prefix}_{filename} already exists ({size_mb:.1f} MB)")
                continue

            remote_path = f"{folder}/{filename}"
            print(f"  [downloading]  {remote_path} ...", end=" ", flush=True)

            try:
                downloaded = kagglehub.dataset_download(
                    handle=DATASET,
                    path=remote_path,
                )
                src = Path(downloaded)

                # kagglehub returns either the file path or a directory path
                if src.is_dir():
                    src = src / filename

                if src.exists():
                    shutil.copy2(str(src), str(target_path))
                    size_mb = target_path.stat().st_size / 1_000_000
                    print(f"done  ({size_mb:.1f} MB)")
                else:
                    print(f"ERROR — downloaded path not found: {src}")

            except Exception as e:
                print(f"ERROR — {e}")

    print(f"\n{'='*50}")
    print(f"  Files in {RAW_DIR}/")
    print(f"{'='*50}")
    for f in sorted(RAW_DIR.glob("*.csv")):
        size_mb = f.stat().st_size / 1_000_000
        print(f"  {f.name:<45} {size_mb:>7.1f} MB")

    print("\nNext: python run_pipeline.py")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python download_pvs.py 2 3")
        sys.exit(1)

    try:
        nums = [int(n) for n in sys.argv[1:]]
    except ValueError:
        print("ERROR: Arguments must be numbers e.g. python download_pvs.py 2 3")
        sys.exit(1)

    invalid = [n for n in nums if n < 1 or n > 9]
    if invalid:
        print(f"ERROR: PVS numbers must be 1-9. Invalid: {invalid}")
        sys.exit(1)

    download_pvs(nums)
