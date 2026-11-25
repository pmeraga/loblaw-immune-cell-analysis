# Loblaw Bio immune cell analysis

[Open the dashboard](https://pmeraga.github.io/loblaw-immune-cell-analysis/) · [Open the repository in Codespaces](https://github.com/codespaces/new?hide_repo_select=true&repo=1472217129)

## Run in GitHub Codespaces

Create a Codespace from the repository's **Code → Codespaces** menu. The dev container provides Python 3.12. In its terminal, run:

```sh
make setup
make pipeline
make dashboard
```

Open the forwarded port **8000** in the Codespaces **Ports** tab. When running locally, open the [local dashboard](http://localhost:8000/) after starting the server. Use Python 3.10–3.13 for the pinned analysis dependencies. Override the interpreter if needed, for example with `make setup PYTHON=python3.12`.

The loader also works without installed dependencies or arguments. Run `python load_data.py` from the repository root to read the bundled CSV and build `cell-count.db`. Re-running replaces the database after a successful load. The pipeline then generates the analysis and downloadable CSVs under `dist/`. The dashboard server regenerates those files from the existing SQLite database before serving them. GitHub Actions builds the hosted dashboard from the same pipeline.

## Data model

`schema.sql` defines projects, subjects, samples, cell populations and cell counts. Subjects are identified by project and subject ID. Samples reference their subject, and cell counts are keyed by sample and population. The source fields for indication and gender are `condition` and `sex`. A blank response becomes SQL NULL. Sample totals and relative frequencies are SQL views, so stored counts remain the source of truth. For a zero-total sample, percentages are undefined and appear blank in the export.

## Analysis

- **Sample frequencies.** The denominator is the sum of the five measured populations in each sample. The table has one row per sample and population and supports filtering by sample ID and population. The full result is available as `dist/relative_frequencies.csv`.
- **Response comparison.** The default comparison uses all eligible PBMC samples from melanoma subjects treated with miraclib whose response was recorded. Each subject contributes their mean sample percentage for each population. The baseline-only option applies the same method to time-zero samples. Tukey boxplots use the observed values within 1.5 times the interquartile range as whiskers. Two-sided Mann–Whitney U tests compare subject-level distributions, with Holm adjustment across five populations in each view and adjusted p < 0.05 as the significance threshold. The table reports group sizes, group medians, the median difference, the responder U statistic, rank-biserial correlation, and raw and adjusted p-values. The all-visits results can reflect post-treatment changes. Both views are exploratory associations, with no adjustment for project or validation of predictive performance. [SciPy test documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.mannwhitneyu.html)
- **Baseline cohort.** Time-zero melanoma PBMC samples from subjects assigned to miraclib are grouped by project. Response and sex totals count distinct project–subject pairs. The complete sample list is available as `dist/baseline_samples.csv`. The separate mean B-cell count uses the raw B-cell counts of all time-zero samples from male melanoma responders, across every sample and treatment type.

The bundled CSV is the supplied assignment dataset. Its Git blob matches the [public copy of the assignment dataset](https://github.com/adk254/Immune-Cell-Analytics-Dashboard/blob/7708700caf75b1b67c436d725cf870581055167d/cell-count.csv).
