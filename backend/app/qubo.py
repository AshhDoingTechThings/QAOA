"""Mathematical model → QUBO → Ising.

Decision variables
------------------
For every facility f we use a 2-bit binary-encoded quantity

        a_f = x_{f,0} + 2·x_{f,1}          a_f ∈ {0, 1, 2, 3} units

and, when the total stock S can be exceeded, ⌈log2(S+1)⌉ slack bits s_j turn the
inequality  Σ_f a_f ≤ S  into the equality  Σ_f a_f + Σ_j 2^j s_j = S.

Objective + penalties (all quadratic in the bits)
-------------------------------------------------
    H = H_cost + λ1·H_capacity + λ2·H_demand + λ3·H_fairness + λ4·H_min-service

    H_cost        = Σ_f c_f · a_f
    H_demand      = Σ_f p_f · max(0, d_f − a_f)          (priority-weighted unmet demand)
    H_capacity    = Σ_f max(0, a_f − cap_f) + (Σ_f a_f + s − S)²
    H_fairness    = Σ_{f<g} (a_f/d_f − a_g/d_g)²          (coverage-ratio equity)
    H_min-service = Σ_f max(0, m_f − a_f)

Any function g(a_f) of one 2-bit register is *exactly* quadratic:
    g(a) = g0 + (g1−g0)·x0 + (g2−g0)·x1 + (g3−g2−g1+g0)·x0·x1
so the piece-wise terms above need no extra ancilla qubits.
"""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from typing import Dict, List

import numpy as np

from .scenario import BITS_PER_FACILITY, MAX_QUBITS, MAX_UNITS, Scenario

TERMS = ["cost", "capacity", "demand", "fairness", "min_service"]


class QuboBuilder:
    def __init__(self, n: int):
        self.Q = np.zeros((n, n))  # upper triangular, diagonal = linear terms
        self.c = 0.0

    def lin(self, i, v):
        self.Q[i, i] += v

    def quad(self, i, j, v):
        if i == j:
            self.Q[i, i] += v
        else:
            a, b = min(i, j), max(i, j)
            self.Q[a, b] += v

    def square(self, terms, const, w=1.0):
        """w · (Σ coef_i x_i + const)²  using x² = x."""
        for k, (i, a) in enumerate(terms):
            self.lin(i, w * (a * a + 2 * const * a))
            for (j, b) in terms[k + 1:]:
                self.quad(i, j, w * 2 * a * b)
        self.c += w * const * const

    def register_fn(self, i0, i1, g, w=1.0):
        g0, g1, g2, g3 = g
        self.c += w * g0
        self.lin(i0, w * (g1 - g0))
        self.lin(i1, w * (g2 - g0))
        self.quad(i0, i1, w * (g3 - g2 - g1 + g0))


@dataclass
class Model:
    scenario: Scenario
    n_fac: int
    n_slack: int
    n_qubits: int
    labels: List[str]
    Q: np.ndarray            # total upper-triangular QUBO (λ applied)
    const: float
    components: Dict[str, tuple] = field(default_factory=dict)  # term -> (Q, const) unweighted
    h: np.ndarray = None
    J: np.ndarray = None
    offset: float = 0.0
    _energies: np.ndarray = None
    _bits: np.ndarray = None

    # ---------------- energies over the full Hilbert space -----------------
    @property
    def bits(self) -> np.ndarray:
        if self._bits is None:
            idx = np.arange(1 << self.n_qubits, dtype=np.int64)
            self._bits = ((idx[:, None] >> np.arange(self.n_qubits)) & 1).astype(np.int8)
        return self._bits

