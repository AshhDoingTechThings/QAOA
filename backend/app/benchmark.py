"""Benchmarking under identical conditions: same instance, same seeds, same
metrics for every solver (PDF slide 22–23)."""
from __future__ import annotations

import math
import statistics as st
from typing import Dict, List

from .qaoa import run_qaoa
from .qubo import Model
from .scenario import BITS_PER_FACILITY, MAX_UNITS
from .solvers import encode_alloc, exact, greedy, simulated_annealing


def _agg(vals: List[float]):
    vals = [v for v in vals if v is not None]
    if not vals:
        return {"mean": None, "std": None, "min": None, "max": None}
    return {"mean": st.fmean(vals), "std": st.pstdev(vals) if len(vals) > 1 else 0.0,
            "min": min(vals), "max": max(vals)}


def run_benchmark(model: Model, seeds=(0, 1, 2), p_list=(1, 2, 3), noise=None, shots=1024,
                  objective="cvar", alpha=0.25) -> Dict:
    ex = exact(model)
    if ex.get("infeasible_problem"):
        return {"error": ex["message"]}
    opt = ex["optimum"]
    opt_idx = encode_alloc(model, ex["solution"]["alloc"])
    rows = []

