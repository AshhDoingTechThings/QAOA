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


