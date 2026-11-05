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


