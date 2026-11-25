"""Query the trial database and build reproducible dashboard artifacts."""

import csv
import json
import shutil
import sqlite3
from contextlib import closing
from statistics import median, quantiles

from scipy.stats import mannwhitneyu

from load_data import DATABASE, POPULATIONS, ROOT

OUTPUT = ROOT / "dist"
ALPHA = 0.05

FREQUENCIES_SQL = """
SELECT f.sample, f.total_count, f.population, f.count, f.percentage
FROM relative_frequencies f JOIN populations p USING (population)
ORDER BY f.sample, p.display_order
"""

SUBJECT_FREQUENCIES_SQL = """
SELECT m.project, m.subject, m.response, f.population, AVG(f.percentage) AS percentage
FROM melanoma_miraclib_pbmc m
JOIN relative_frequencies f USING (sample)
WHERE m.response IN ('yes', 'no')
  AND (? = 0 OR m.time_from_treatment_start = 0)
  AND f.percentage IS NOT NULL
GROUP BY m.project, m.subject, m.response, f.population
"""

BASELINE_B_CELLS_SQL = """
SELECT AVG(c.count) AS mean, COUNT(*) AS samples
FROM sample_metadata m JOIN cell_counts c USING (sample)
WHERE m.condition = 'melanoma' AND m.sex = 'M' AND m.response = 'yes'
  AND m.time_from_treatment_start = 0 AND c.population = 'b_cell'
"""


def box_summary(values):
    if not values:
        return None
    ordered = sorted(values)
    q1, center, q3 = quantiles(ordered, n=4, method="inclusive") if len(ordered) > 1 else ordered * 3
    spread = 1.5 * (q3 - q1)
    lower = next(value for value in ordered if value >= q1 - spread)
    upper = next(value for value in reversed(ordered) if value <= q3 + spread)
    return {
        "min": lower, "q1": q1, "median": center, "q3": q3, "max": upper,
        "outliers": [value for value in ordered if value < lower or value > upper],
    }


def compare_response(connection, baseline_only):
    groups = {population: {"yes": [], "no": []} for population in POPULATIONS}
    for row in connection.execute(SUBJECT_FREQUENCIES_SQL, (baseline_only,)):
        groups[row["population"]][row["response"]].append(row["percentage"])

    results = []
    for population, group in groups.items():
        yes, no = group["yes"], group["no"]
        result = {
            "population": population,
            "n_yes": len(yes),
            "n_no": len(no),
            "yes": box_summary(yes),
            "no": box_summary(no),
            "median_difference": None,
            "u": None,
            "rank_biserial": None,
            "p": None,
            "p_adjusted": None,
            "significant": None,
        }
        if yes and no:
            u, p = mannwhitneyu(yes, no, alternative="two-sided", method="asymptotic")
            result.update(
                median_difference=median(yes) - median(no),
                u=float(u),
                rank_biserial=float(2 * u / (len(yes) * len(no)) - 1),
                p=float(p),
            )
        results.append(result)

    # Holm adjustment is monotone in ascending raw p-value order.
    highest = 0.0
    testable = sorted((r for r in results if r["p"] is not None), key=lambda r: r["p"])
    for order, result in enumerate(testable):
        highest = min(1.0, max(highest, (len(results) - order) * result["p"]))
        result.update(p_adjusted=highest, significant=highest < ALPHA)
    return results


def grouped_counts(connection, sql):
    return {label: count for label, count in connection.execute(sql)}


def write_csv(path, rows, fields):
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(fields)
        writer.writerows(rows)


def build_dashboard():
    if not DATABASE.is_file():
        raise SystemExit("Missing cell-count.db. Run make pipeline first.")

    with closing(sqlite3.connect(DATABASE.as_uri() + "?mode=ro", uri=True)) as connection:
        # Use a single read transaction to keep the reports on one snapshot.
        connection.row_factory = sqlite3.Row
        connection.execute("BEGIN")
        frequencies = list(connection.execute(FREQUENCIES_SQL))
        baseline = list(connection.execute(
            "SELECT * FROM baseline_melanoma_miraclib_pbmc ORDER BY project, subject, sample"
        ))
        by_project = grouped_counts(connection, """
            SELECT p.project, COUNT(b.sample)
            FROM projects p LEFT JOIN baseline_melanoma_miraclib_pbmc b USING (project)
            GROUP BY p.project ORDER BY p.project
        """)
        # The DISTINCT subquery identifies subjects by their project and subject key.
        breakdown = {}
        for field in ("response", "sex"):
            breakdown[field] = grouped_counts(connection, f"""
                SELECT COALESCE({field}, 'unknown'), COUNT(*)
                FROM (SELECT DISTINCT project, subject, {field}
                      FROM baseline_melanoma_miraclib_pbmc)
                GROUP BY {field} ORDER BY {field}
            """)
        average = dict(connection.execute(BASELINE_B_CELLS_SQL).fetchone())
        data = {
            "sample_count": connection.execute("SELECT COUNT(*) FROM samples").fetchone()[0],
            "subject_count": connection.execute("SELECT COUNT(*) FROM subjects").fetchone()[0],
            "populations": POPULATIONS,
            "alpha": ALPHA,
            "comparison": {
                "all": compare_response(connection, False),
                "baseline": compare_response(connection, True),
            },
            "baseline": {
                "samples": [dict(row) for row in baseline],
                "projects": by_project,
                **breakdown,
                "average_b_cell": average,
            },
        }

    shutil.copytree(ROOT / "web", OUTPUT, dirs_exist_ok=True)
    (OUTPUT / "dashboard.json").write_text(json.dumps(data, allow_nan=False), encoding="utf-8")
    (OUTPUT / "frequencies.json").write_text(
        json.dumps([list(row) for row in frequencies], separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    write_csv(OUTPUT / "relative_frequencies.csv", frequencies,
              ("sample", "total_count", "population", "count", "percentage"))
    write_csv(OUTPUT / "baseline_samples.csv", baseline,
              ("sample", "project", "subject", "condition", "age", "sex",
               "treatment", "response", "sample_type", "time_from_treatment_start"))
    return data


if __name__ == "__main__":
    data = build_dashboard()
    for cohort, results in data["comparison"].items():
        significant = [r["population"] for r in results if r["significant"]]
        print(f"Significant populations ({cohort} visits, Holm p < {ALPHA}): "
              f"{', '.join(significant) or 'none'}")
    print(f"Baseline cohort samples: {len(data['baseline']['samples']):,}")
    average = data["baseline"]["average_b_cell"]
    mean = f"{average['mean']:.2f}" if average["mean"] is not None else "Unavailable"
    print(f"Average baseline B-cell count for male melanoma responders: {mean} "
          f"(n={average['samples']:,} samples)")
    print("Dashboard assets and CSVs written to dist/.")
