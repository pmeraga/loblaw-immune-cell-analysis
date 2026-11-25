"""Build the root SQLite database from the supplied sample CSV."""

import csv
import sqlite3
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "cell-count.db"
SOURCE = ROOT / "cell-count.csv"
POPULATIONS = ("b_cell", "cd8_t_cell", "cd4_t_cell", "nk_cell", "monocyte")


def load_data(source=SOURCE, database=DATABASE):
    subjects = {}
    samples = []
    counts = []

    with source.open(newline="", encoding="utf-8-sig") as source_file:
        for line, row in enumerate(csv.DictReader(source_file), start=2):
            try:
                project, subject = row["project"].strip(), row["subject"].strip()
                sample = row["sample"].strip()
                if not all((project, subject, sample)):
                    raise ValueError("missing project, subject or sample ID")
                key = project, subject
                metadata = (
                    row["condition"].strip().lower(),
                    int(row["age"]),
                    row["sex"].strip().upper(),
                    row["treatment"].strip().lower(),
                    row["response"].strip().lower() or None,
                )
                if subjects.setdefault(key, metadata) != metadata:
                    raise ValueError(f"conflicting metadata for {project}/{subject}")
                samples.append(
                    (sample, *key, row["sample_type"].strip().upper(),
                     int(row["time_from_treatment_start"]))
                )
                counts.extend((sample, population, int(row[population])) for population in POPULATIONS)
            except (AttributeError, KeyError, TypeError, ValueError) as error:
                raise ValueError(f"{source.name}, line {line}: {error}") from error

    # Keep the prior database intact if parsing, insertion or validation fails.
    with TemporaryDirectory(dir=database.parent) as staging:
        staged = Path(staging) / database.name
        with closing(sqlite3.connect(staged)) as connection, connection:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.executescript((ROOT / "schema.sql").read_text())
            connection.executemany(
                "INSERT INTO projects VALUES (?)", [(p,) for p in sorted({p for p, _ in subjects})]
            )
            connection.executemany(
                "INSERT INTO subjects VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(*key, *metadata) for key, metadata in subjects.items()],
            )
            connection.executemany("INSERT INTO samples VALUES (?, ?, ?, ?, ?)", samples)
            connection.executemany("INSERT INTO populations VALUES (?, ?)", enumerate_populations())
            connection.executemany("INSERT INTO cell_counts VALUES (?, ?, ?)", counts)
        staged.replace(database)

    return len(samples), len(subjects), len(counts)


def enumerate_populations():
    return [(population, order) for order, population in enumerate(POPULATIONS)]


if __name__ == "__main__":
    samples, subjects, counts = load_data()
    print(f"Loaded {samples:,} samples, {subjects:,} subjects and {counts:,} counts into {DATABASE.name}.")
