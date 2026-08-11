"""
Unit tests for genie.py pure functions.
No Databricks or LLM calls — all blocking I/O is mocked or not invoked.
Run:  cd backend && python -m pytest tests/test_genie.py -v
"""

import math
import pytest
import pandas as pd
import sys
import os

# Allow import from routers package without installing
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.genie import (
    _check_balanced_parens,
    _extract_and_validate_sql,
    _coerce_numerics,
    _classify_numeric_cols,
    _compute_kpis,
    _build_widgets,
    _safe_num,
    _is_date_col,
    _detect_stacked_intent,
)


# ── _check_balanced_parens ────────────────────────────────────────────────────

class TestCheckBalancedParens:
    def test_balanced(self):
        _check_balanced_parens("SELECT COUNT(*) FROM t")  # should not raise

    def test_unbalanced_open(self):
        with pytest.raises(ValueError, match="truncated"):
            _check_balanced_parens("SELECT COUNT( FROM t")

    def test_unbalanced_close(self):
        with pytest.raises(ValueError):
            _check_balanced_parens("SELECT 1) FROM t")

    def test_ignores_parens_in_string_literals(self):
        _check_balanced_parens("SELECT '(unclosed' FROM t")  # no raise

    def test_nested_balanced(self):
        _check_balanced_parens("SELECT COALESCE(SUM(a), 0) FROM t")  # no raise


# ── _extract_and_validate_sql ─────────────────────────────────────────────────

class TestExtractAndValidateSql:
    def test_strips_markdown_fences(self):
        raw = "```sql\nSELECT 1\n```"
        sql = _extract_and_validate_sql(raw)
        assert "```" not in sql
        assert "SELECT 1" in sql

    def test_appends_limit_when_missing(self):
        sql = _extract_and_validate_sql("SELECT 1")
        assert "LIMIT" in sql.upper()

    def test_does_not_double_limit(self):
        sql = _extract_and_validate_sql("SELECT 1 LIMIT 500")
        assert sql.upper().count("LIMIT") == 1

    def test_rejects_non_select(self):
        with pytest.raises(ValueError, match="not a SELECT"):
            _extract_and_validate_sql("INSERT INTO t VALUES (1)")

    def test_rejects_dml_inside_select(self):
        with pytest.raises(ValueError, match="prohibited"):
            _extract_and_validate_sql("SELECT * FROM t; DROP TABLE t")

    def test_rejects_unbalanced_parens(self):
        with pytest.raises(ValueError):
            _extract_and_validate_sql("SELECT COUNT( FROM t")

    def test_with_clause(self):
        sql = _extract_and_validate_sql("WITH cte AS (SELECT 1) SELECT * FROM cte")
        assert sql.upper().startswith("WITH")


# ── _safe_num ─────────────────────────────────────────────────────────────────

class TestSafeNum:
    def test_integer(self):
        assert _safe_num(42) == 42

    def test_float(self):
        assert abs(_safe_num(3.14159) - 3.1416) < 0.0001

    def test_nan_returns_zero(self):
        assert _safe_num(float("nan")) == 0

    def test_inf_returns_zero(self):
        assert _safe_num(float("inf")) == 0
        assert _safe_num(float("-inf")) == 0

    def test_none_returns_zero(self):
        assert _safe_num(None) == 0

    def test_string_number(self):
        assert _safe_num("100") == 100


# ── _is_date_col ──────────────────────────────────────────────────────────────

class TestIsDateCol:
    def test_recognises_single_word_date_columns(self):
        assert _is_date_col("date")
        assert _is_date_col("month")
        assert _is_date_col("year")
        assert _is_date_col("start")
        assert _is_date_col("end")

    def test_recognises_compound_date_columns(self):
        # Underscore-separated names: "created_at" → {"created", "at"}, "at" is in hints
        assert _is_date_col("created_at")
        assert _is_date_col("start_date")
        assert _is_date_col("updated_at")
        assert _is_date_col("Programme_End_Date")

    def test_ignores_non_date_columns(self):
        assert not _is_date_col("employee_count")
        assert not _is_date_col("leadership_stage")
        assert not _is_date_col("programme_name")


# ── _coerce_numerics ──────────────────────────────────────────────────────────

class TestCoerceNumerics:
    def test_coerces_string_numbers(self):
        df = pd.DataFrame({"count": ["5", "10", "15"]})
        _coerce_numerics(df)
        assert pd.api.types.is_numeric_dtype(df["count"])

    def test_skips_id_columns(self):
        df = pd.DataFrame({"EmployeeID": ["24428017", "24428018"]})
        _coerce_numerics(df)
        assert df["EmployeeID"].dtype == object

    def test_skips_columns_with_mixed_strings(self):
        df = pd.DataFrame({"label": ["A", "B", "C"]})
        _coerce_numerics(df)
        assert df["label"].dtype == object

    def test_threshold_80_pct(self):
        # Only 7/10 values are numeric — below 80% → should NOT coerce
        df = pd.DataFrame({"val": ["1", "2", "3", "4", "5", "6", "7", "A", "B", "C"]})
        _coerce_numerics(df)
        assert df["val"].dtype == object


# ── _classify_numeric_cols ────────────────────────────────────────────────────

class TestClassifyNumericCols:
    def test_id_column_classified_as_dim(self):
        # Must have a real measure alongside — otherwise fallback promotes the only column
        df = pd.DataFrame({
            "EmployeeID":      [24428017, 24428018, 24428019, 24428020],
            "Programme_Count": [3, 5, 2, 8],
        })
        df = df.apply(pd.to_numeric)
        dims, measures = _classify_numeric_cols(df, ["EmployeeID", "Programme_Count"])
        assert "EmployeeID" in dims
        assert "EmployeeID" not in measures
        assert "Programme_Count" in measures

    def test_count_column_always_measure(self):
        df = pd.DataFrame({"Programme_Count": [1, 2, 3, 4, 5]})
        df["Programme_Count"] = pd.to_numeric(df["Programme_Count"])
        dims, measures = _classify_numeric_cols(df, ["Programme_Count"])
        assert "Programme_Count" in measures
        assert "Programme_Count" not in dims

    def test_small_integer_range_classified_as_dim(self):
        # Leadership stage 1-5 must be a dim when a true measure column is present
        df = pd.DataFrame({
            "stage":      [1, 2, 3, 4, 5] * 10,
            "headcount":  [10, 20, 30, 40, 50] * 10,
        })
        dims, measures = _classify_numeric_cols(df, ["stage", "headcount"])
        assert "stage" in dims
        assert "stage" not in measures
        assert "headcount" in measures

    def test_large_numeric_range_classified_as_measure(self):
        df = pd.DataFrame({"salary": [50000, 60000, 70000, 80000, 90000]})
        dims, measures = _classify_numeric_cols(df, ["salary"])
        assert "salary" in measures

    def test_fallback_when_no_measures(self):
        # All dim-like: fallback promotes them to measures
        df = pd.DataFrame({"stage": [1, 2, 3]})
        dims, measures = _classify_numeric_cols(df, ["stage"])
        assert len(measures) > 0


# ── _compute_kpis ─────────────────────────────────────────────────────────────

class TestComputeKpis:
    def _make_df(self, rows):
        df = pd.DataFrame(rows)
        return df

    def test_always_returns_four_kpis(self):
        rows = [{"stage": 1, "count": 10}, {"stage": 2, "count": 20}]
        df   = self._make_df(rows)
        kpis = _compute_kpis(rows, df, ["count"], ["stage"])
        assert len(kpis) == 4

    def test_all_kpis_are_kpi_card_type(self):
        rows = [{"stage": 1, "count": 10}]
        df   = self._make_df(rows)
        kpis = _compute_kpis(rows, df, ["count"], ["stage"])
        assert all(k["type"] == "KPI_CARD" for k in kpis)

    def test_pads_with_total_records(self):
        # Empty measures → all 4 should be "Total Records"
        rows = [{"name": "A"}]
        df   = self._make_df(rows)
        kpis = _compute_kpis(rows, df, [], [])
        assert all(k["title"] == "Total Records" for k in kpis)

    def test_single_row_uses_measure_values(self):
        rows = [{"revenue": 1000}]
        df   = self._make_df(rows)
        kpis = _compute_kpis(rows, df, ["revenue"], [])
        values = [k["data"][0]["value"] for k in kpis]
        # First KPI should reflect the revenue value
        assert 1000 in values


# ── _build_widgets ────────────────────────────────────────────────────────────

class TestBuildWidgets:
    def test_empty_rows_returns_single_table(self):
        widgets = _build_widgets([])
        assert len(widgets) == 1
        assert widgets[0]["type"] == "TABLE"

    def test_always_has_four_kpis(self):
        rows = [{"stage": i, "count": i * 10} for i in range(1, 6)]
        widgets = _build_widgets(rows)
        kpis = [w for w in widgets if w["type"] == "KPI_CARD"]
        assert len(kpis) == 4

    def test_always_ends_with_table(self):
        rows = [{"stage": i, "count": i * 10} for i in range(1, 6)]
        widgets = _build_widgets(rows)
        assert widgets[-1]["type"] == "TABLE"

    def test_bar_chart_for_categorical_data(self):
        rows = [{"stage": str(i), "count": i * 10} for i in range(1, 6)]
        widgets = _build_widgets(rows)
        chart_types = {w["type"] for w in widgets}
        assert "BAR_CHART" in chart_types

    def test_leadership_stage_produces_bar_chart(self):
        # Real-world regression: numeric stage codes 1-5 must become BAR_CHART x-axis
        rows = [{"Sun_Ray_Leadership_Stage": i, "employee_count": i * 20} for i in range(1, 6)]
        widgets = _build_widgets(rows)
        bar = next((w for w in widgets if w["type"] == "BAR_CHART"), None)
        assert bar is not None, "Expected a BAR_CHART for leadership stage data"
        assert bar["x_key"] == "Sun_Ray_Leadership_Stage"

    def test_employee_id_not_used_as_measure(self):
        # Real-world regression: EmployeeID strings must NOT become a KPI measure
        rows = [{"EmployeeID": str(24428000 + i), "Programme_Count": i} for i in range(1, 6)]
        widgets = _build_widgets(rows)
        kpis = [w for w in widgets if w["type"] == "KPI_CARD"]
        for kpi in kpis:
            assert "EmployeeID" not in kpi.get("title", "").lower() or "unique" in kpi.get("title", "").lower()

    def test_multi_dim_produces_stacked_chart_with_unique_x(self):
        # Real-world regression: 45 rows (Programme × Stage) must never produce 45 bars.
        # Auto-detection should produce a STACKED_BAR_CHART with one row per programme.
        stages = list(range(1, 6))  # 5 stages
        programmes = [f"Prog_{p}" for p in range(1, 10)]  # 9 programmes
        rows = [
            {"Sun_Ray_Leadership_Stage": s, "Programme_Name": p, "Employee_Count": s * 5}
            for s in stages for p in programmes
        ]  # 45 rows
        widgets = _build_widgets(rows)
        chart = next((w for w in widgets if w["type"] == "STACKED_BAR_CHART"), None)
        assert chart is not None, "Multi-dim data should produce STACKED_BAR_CHART"
        # x values must be unique (one row per programme in the pivot)
        x_vals = [r[chart["x_key"]] for r in chart["data"]]
        assert len(x_vals) == len(set(x_vals)), "x-axis values must be unique after pivot"


# ── _detect_stacked_intent ────────────────────────────────────────────────────

class TestDetectStackedIntent:
    def test_detects_stacked_keyword(self):
        stacked, top_n = _detect_stacked_intent("show me stacked bar chart")
        assert stacked is True
        assert top_n is None

    def test_detects_stack_without_ed(self):
        stacked, _ = _detect_stacked_intent("stack bar for leadership stage")
        assert stacked is True

    def test_not_stacked_for_regular_bar(self):
        stacked, _ = _detect_stacked_intent("show me bar chart for employee count")
        assert stacked is False

    def test_detects_top_n(self):
        _, top_n = _detect_stacked_intent("top 10 programmes stacked by stage")
        assert top_n == 10

    def test_top_n_without_stacked(self):
        stacked, top_n = _detect_stacked_intent("top 5 programmes by count")
        assert stacked is False
        assert top_n == 5


# ── _build_widgets stacked bar ────────────────────────────────────────────────

class TestBuildWidgetsStacked:
    def _make_multi_dim_rows(self, n_programmes=10, stages=(1, 2, 3, 4, 5)):
        return [
            {"Programme_Name": f"Programme_{p}", "Sun_Ray_Leadership_Stage": s, "Employee_Count": p * s}
            for p in range(1, n_programmes + 1)
            for s in stages
        ]

    def test_stacked_question_produces_stacked_bar_chart(self):
        rows = self._make_multi_dim_rows()
        widgets = _build_widgets(rows, "show stacked bar chart for programme by leadership stage")
        chart = next((w for w in widgets if w["type"] == "STACKED_BAR_CHART"), None)
        assert chart is not None, "Expected STACKED_BAR_CHART widget"

    def test_stacked_chart_x_key_is_higher_cardinality_dim(self):
        rows = self._make_multi_dim_rows()
        widgets = _build_widgets(rows, "stacked bar chart for programmes by stage")
        chart = next(w for w in widgets if w["type"] == "STACKED_BAR_CHART")
        # Programme_Name has 10 unique values, stage has 5 — programme should be x
        assert chart["x_key"] == "Programme_Name"

    def test_stacked_chart_y_keys_are_stage_values(self):
        rows = self._make_multi_dim_rows(stages=(1, 2, 3, 4, 5))
        widgets = _build_widgets(rows, "stacked bar")
        chart = next(w for w in widgets if w["type"] == "STACKED_BAR_CHART")
        # y_keys are the pivot column names (stringified stage values)
        assert set(chart["y_keys"]) == {"1", "2", "3", "4", "5"}

    def test_top_n_limits_rows(self):
        rows = self._make_multi_dim_rows(n_programmes=20)
        widgets = _build_widgets(rows, "top 10 stacked bar chart by programme and stage")
        chart = next(w for w in widgets if w["type"] == "STACKED_BAR_CHART")
        assert len(chart["data"]) == 10

    def test_stacked_data_has_no_repeated_x_values(self):
        rows = self._make_multi_dim_rows()
        widgets = _build_widgets(rows, "stacked bar")
        chart = next(w for w in widgets if w["type"] == "STACKED_BAR_CHART")
        x_vals = [r[chart["x_key"]] for r in chart["data"]]
        assert len(x_vals) == len(set(x_vals)), "Each x value must appear exactly once"

    def test_auto_detects_stacked_from_multidim_data(self):
        # No "stacked" keyword — but multi-dim data shape should trigger auto-detection
        rows = self._make_multi_dim_rows()
        widgets = _build_widgets(rows, "show me programme by stage")
        chart = next((w for w in widgets if w["type"] == "STACKED_BAR_CHART"), None)
        assert chart is not None, "Multi-dim data should auto-produce STACKED_BAR_CHART without keyword"

    def test_single_dim_produces_bar_not_stacked(self):
        # Only one categorical column — no stacked bar, plain bar only
        rows = [{"Programme_Name": f"P{i}", "Employee_Count": i * 10} for i in range(1, 11)]
        widgets = _build_widgets(rows, "show me programme headcount")
        types = [w["type"] for w in widgets]
        assert "STACKED_BAR_CHART" not in types
        assert "BAR_CHART" in types

    def test_multidim_with_date_generates_stacked_and_line(self):
        # Multi-dim categorical + date column → both STACKED_BAR_CHART and LINE_CHART
        import datetime
        rows = [
            {
                "Programme_Name": f"Programme_{p}",
                "Sun_Ray_Leadership_Stage": s,
                "Employee_Count": p * s,
                "Start_Date": f"2023-0{s}-01",
            }
            for p in range(1, 6) for s in range(1, 4)
        ]
        widgets = _build_widgets(rows, "full analysis")
        types = [w["type"] for w in widgets]
        assert "STACKED_BAR_CHART" in types
        assert "LINE_CHART" in types
