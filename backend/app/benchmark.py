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

    def row(name, key, runs, extra=None):
        sols = [r["solution"] for r in runs]
        feas_obj = [s["objective"] for s in sols if s["feasible"]]
        r = {
            "solver": name, "key": key, "runs": len(runs),
            "objective": _agg([s["objective"] for s in sols]),
            "feasible_objective": _agg(feas_obj),
            "gap_pct": _agg([s.get("gap_pct") for s in sols]),
            "approx_ratio": _agg([s.get("approx_ratio") for s in sols]),
            "solution_feasible_rate": sum(s["feasible"] for s in sols) / len(sols),
            "found_optimum_rate": sum(abs(s["objective"] - opt) < 1e-9 and s["feasible"] for s in sols) / len(sols),
            "constraint_satisfaction": _agg([s["constraints_satisfied"] / s["constraints_total"] for s in sols]),
            "runtime_ms": _agg([r["runtime_ms"] for r in runs]),
            "qubits": model.n_qubits if key.startswith("qaoa") else None,
        }
        if extra:
            r.update(extra(runs))
        rows.append(r)

    row("Exact enumeration", "exact", [ex])
    row("Rule-based greedy", "greedy", [greedy(model, opt)])
    row("Simulated annealing", "sa", [simulated_annealing(model, seed=s, optimum=opt) for s in seeds])

    for p in p_list:
        runs = [run_qaoa(model, opt, opt_idx, p=p, seed=s, shots=shots, objective=objective, alpha=alpha,
                         init="interp" if s == seeds[0] else "random", restarts=2, noise=noise, crosscheck=False) for s in seeds]

        def q_extra(rs):
            c = rs[0]["circuit"]
            tr = c.get("transpiled", {})
            return {
                "feasibility_rate": _agg([r["sampled"]["feasibility_rate"] for r in rs]),
                "p_opt": _agg([r["sampled"]["p_opt_alloc"] for r in rs]),
                "expectation": _agg([r["ideal"]["expectation"] for r in rs]),
                "depth": tr.get("all_to_all", {}).get("depth", c["analytic"]["depth"]),
                "depth_linear": tr.get("linear", {}).get("depth"),
                "cx": tr.get("all_to_all", {}).get("cx", c["analytic"]["cx"]),
                "cx_linear": tr.get("linear", {}).get("cx"),
                "p": rs[0]["p"],
            }

        row(f"QAOA p={p}", f"qaoa{p}", runs, q_extra)

        if noise and noise.get("enabled"):
            nruns = []
            for r in runs:
                nr = dict(r)
                nr["solution"] = r["noisy"]["best_measured"]
                nr["runtime_ms"] = r["runtime_ms"] + r["noisy"]["runtime_ms"]
                nruns.append(nr)

            def n_extra(rs):
                base = q_extra(rs)
                base["feasibility_rate"] = _agg([r["noisy"]["feasibility_rate"] for r in rs])
                base["p_opt"] = _agg([r["noisy"]["p_opt_alloc"] for r in rs])
                base["expectation"] = _agg([r["noisy"]["expectation"] for r in rs])
                base["est_fidelity"] = rs[0]["noisy"]["est_fidelity"]
                return base

            row(f"QAOA p={p} (noisy)", f"qaoa{p}n", nruns, n_extra)

    return {"optimum": opt, "rows": rows, "seeds": list(seeds), "p_list": list(p_list),
            "n_qubits": model.n_qubits, "formulation_valid": ex["formulation_valid"],
            "scaling": scaling_table(model)}


def scaling_table(model: Model):
    """Qubit and search-space growth as the number of facilities increases."""
    S = model.scenario.supply
    out = []
    for F in range(2, 11):
        slack = 0 if S >= MAX_UNITS * F else max(1, math.ceil(math.log2(S + 1)))
        n = BITS_PER_FACILITY * F + slack
        zz = n * (n - 1) // 2  # worst case (fairness + stock couple everything)
        out.append({"facilities": F, "qubits": n, "states": 2 ** n, "allocations": 4 ** F,
                    "zz_terms_max": zz, "cx_per_layer_max": 2 * zz})
    return out
