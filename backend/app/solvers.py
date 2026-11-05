"""Classical solvers: exact enumeration (ground truth), rule-based greedy
(how allocation is done today) and simulated annealing on the QUBO (classical
optimisation baseline)."""
from __future__ import annotations

import itertools
import time
from typing import Dict

import numpy as np

from .qubo import Model, describe_solution, feasible_mask, is_feasible, objective_of_alloc
from .scenario import MAX_UNITS


def encode_alloc(model: Model, alloc) -> int:
    """Allocation → basis index with a consistent slack register."""
    idx = 0
    for f, a in enumerate(alloc):
        idx |= (a & 1) << (2 * f)
        idx |= ((a >> 1) & 1) << (2 * f + 1)
    if model.n_slack:
        s = model.scenario.supply - sum(alloc)
        s = min(max(s, 0), (1 << model.n_slack) - 1)
        idx |= s << (2 * model.n_fac)
    return idx


def exact(model: Model) -> Dict:
    """Two exact views:
    1. brute-force minimum of the QUBO over all 2^n bitstrings (what QAOA targets)
    2. brute-force optimum of the ORIGINAL constrained problem over all allocations
    If λ is well chosen these coincide — a direct validation of the formulation."""
    sc = model.scenario
    t0 = time.perf_counter()
    E = model.energies
    g = int(np.argmin(E))
    t_qubo = time.perf_counter() - t0

    t0 = time.perf_counter()
    best, best_alloc, n_feas = None, None, 0
    for alloc in itertools.product(range(MAX_UNITS + 1), repeat=model.n_fac):
        if not is_feasible(sc, alloc):
            continue
        n_feas += 1
        v = objective_of_alloc(sc, alloc)["objective"]
        if best is None or v < best - 1e-12:
            best, best_alloc = v, alloc
    t_alloc = time.perf_counter() - t0

    if best is None:
        return {"solver": "exact", "infeasible_problem": True,
                "message": "No allocation satisfies all hard constraints (check supply vs. minimum service)."}

    opt_idx = encode_alloc(model, best_alloc)
    sol = describe_solution(model, opt_idx, best)
    ground = describe_solution(model, g, best)
    fmask = feasible_mask(model)

    # spectrum for visualisation: sorted energies with feasibility flag (downsampled)
    order = np.argsort(E)
    take = order[: min(len(order), 400)]
    spectrum = [{"e": float(E[i]), "f": bool(fmask[i])} for i in take]

    return {
        "solver": "exact",
        "label": "Exact enumeration",
        "solution": sol,
        "optimum": best,
        "ground_state": ground,
        "formulation_valid": bool(abs(E[g] - E[opt_idx]) < 1e-9 and ground["feasible"]),
        "n_states": int(len(E)),
        "n_feasible_states": int(fmask.sum()),
        "n_feasible_allocations": n_feas,
        "runtime_ms": 1000 * (t_qubo + t_alloc),
        "runtime_qubo_ms": 1000 * t_qubo,
        "spectrum": spectrum,
        "energy_min": float(E.min()), "energy_max": float(E.max()),
    }


