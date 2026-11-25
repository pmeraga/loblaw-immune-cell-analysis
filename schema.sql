CREATE TABLE projects (
    project TEXT PRIMARY KEY NOT NULL
) WITHOUT ROWID;

CREATE TABLE subjects (
    project TEXT NOT NULL REFERENCES projects,
    subject TEXT NOT NULL,
    condition TEXT NOT NULL COLLATE NOCASE,
    age INTEGER NOT NULL CHECK (age >= 0),
    sex TEXT NOT NULL COLLATE NOCASE,
    treatment TEXT NOT NULL COLLATE NOCASE,
    response TEXT COLLATE NOCASE CHECK (response IN ('yes', 'no')),
    PRIMARY KEY (project, subject)
) WITHOUT ROWID;

CREATE TABLE samples (
    sample TEXT PRIMARY KEY NOT NULL,
    project TEXT NOT NULL,
    subject TEXT NOT NULL,
    sample_type TEXT NOT NULL COLLATE NOCASE,
    time_from_treatment_start INTEGER NOT NULL,
    FOREIGN KEY (project, subject) REFERENCES subjects
) WITHOUT ROWID;

CREATE TABLE populations (
    population TEXT PRIMARY KEY NOT NULL,
    display_order INTEGER NOT NULL UNIQUE
) WITHOUT ROWID;

CREATE TABLE cell_counts (
    sample TEXT NOT NULL REFERENCES samples,
    population TEXT NOT NULL REFERENCES populations,
    count INTEGER NOT NULL CHECK (count >= 0),
    PRIMARY KEY (sample, population)
) WITHOUT ROWID;

CREATE INDEX subjects_cohort ON subjects (condition, treatment, response);
CREATE INDEX samples_by_subject ON samples
    (project, subject, sample_type, time_from_treatment_start);

CREATE VIEW sample_totals AS
SELECT sample, SUM(count) AS total_count
FROM cell_counts
GROUP BY sample;

CREATE VIEW relative_frequencies AS
SELECT c.sample, t.total_count, c.population, c.count,
       100.0 * c.count / NULLIF(t.total_count, 0) AS percentage
FROM cell_counts c
JOIN sample_totals t USING (sample);

CREATE VIEW sample_metadata AS
SELECT s.sample, s.project, s.subject, u.condition, u.age, u.sex, u.treatment,
       u.response, s.sample_type, s.time_from_treatment_start
FROM samples s
JOIN subjects u USING (project, subject);

CREATE VIEW melanoma_miraclib_pbmc AS
SELECT *
FROM sample_metadata
WHERE condition = 'melanoma' COLLATE NOCASE
  AND treatment = 'miraclib' COLLATE NOCASE
  AND sample_type = 'PBMC' COLLATE NOCASE;

CREATE VIEW baseline_melanoma_miraclib_pbmc AS
SELECT *
FROM melanoma_miraclib_pbmc
WHERE time_from_treatment_start = 0;
